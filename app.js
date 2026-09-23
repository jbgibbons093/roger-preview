import * as cdm from './cdm.js?v=d6e53643d0f2';
import { freshDefinition, readDefinition, validateDefinition, connectionIssues, requiredTables, compileSas, parseCodes, TABLES as RAW_TABLES, DOMAINS as RAW_DOMAINS } from './cohort.js?v=d6e53643d0f2';
import { openCodePicker } from './code-picker.js?v=d6e53643d0f2';
import { treeFor, groupsIn, logicText, usesOr, removeCriterion } from './logic.js?v=d6e53643d0f2';
import { renderTree, bindTree } from './cohort-tree.js?v=d6e53643d0f2';
import { selectionProtocol } from './protocol.js?v=d6e53643d0f2';
import { parseCsv, previewRows, quickCounts, missingness, compileQuickCount } from './results.js?v=d6e53643d0f2';
import { parseRunFolder, parseOutputParent } from './paths.js?v=d6e53643d0f2';
import { PROFILE_KEY, DEFAULT_LINK_SCRIPT, createProfile, readProfileStore, profileFromSettings } from './profiles.js?v=d6e53643d0f2';
import { SAVED_COHORTS_KEY, readSavedCohorts, upsertSavedCohort } from './saved-cohorts.js?v=d6e53643d0f2';

const DRAFT_KEY = 'roger.cohort.cdm.v1', LEGACY_DRAFT_KEY = 'roger.cohort.v1', CONNECT_KEY='roger.sasconnect.v1', DESKTOP_KEY='roger.desktop.v1';
const desktop=window.rogerDesktop||null;
let definition = cdm.freshDefinition();
let connectSettings={host:'',port:12600,script:DEFAULT_LINK_SCRIPT,resultsFolder:'',includeCohort:false};
let desktopSettings={sasExecutable:'',serverUser:'',outputParent:''},desktopJob=null,desktopSourcePath='',connectionCheck=null;
let profiles=[],activeProfileId='';
let savedCohorts=[],selectedSavedCohortId='',selectedRunCohortId='',selectedRunProfileId='',sasPathCheck=null,cohortDirty=false;
let desktopDefaultHost='';
let TABLES=cdm.TABLES, DOMAINS=cdm.DOMAINS;
let rawCatalog, rawEngine, cdmEngine;
const activeCdm=()=>cdm.isCdm(definition);
const populationLabel=()=>activeCdm()?`Mini-Sentinel CDM · ${definition.yearStart}–${definition.yearEnd}`:`MarketScan ${catalog.families[definition.family]} · 2023 · Set ${definition.edition}`;
const ageLabel=()=>activeCdm()?'Age at index':'Reported age';
function activate(){ TABLES=activeCdm()?cdm.TABLES:RAW_TABLES; DOMAINS=activeCdm()?cdm.DOMAINS:RAW_DOMAINS; catalog=activeCdm()?cdm.catalog:rawCatalog; engine=activeCdm()?cdmEngine:rawEngine; }
let view = 'graph';
let catalog, engine, toastTimer, runRefreshTimer;
const resultTables=new Map();
let selectedResult='', resultState={search:'',sortColumn:'',descending:false,page:1,visible:null,countColumn:'',splitColumn:''};
const app = document.querySelector('#app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const option = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
const field = (label, key, value, type = 'text', extra = '') => `<div><label for="${key}">${label}</label><input id="${key}" data-field="${key}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const number = (label, key, value, min = 0, max = activeCdm()?3650:365) => field(label, key, value, 'number', `min="${min}" max="${max}" step="1"`);
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 4500); }
function changed() { document.querySelector('#save-state').textContent = 'Unsaved changes'; selectedRunCohortId='';cohortDirty=true;if(view==='saved')app.querySelectorAll('[data-action^="export-"]').forEach(button=>button.disabled=true); }
function panel(n, title, subtitle, content) { return `<section class="panel"><div class="panel-head"><span class="step-number">${n}</span><div><h2>${title}</h2><p>${subtitle}</p></div></div><div class="panel-body">${content}</div></section>`; }
function setView(next) { view = next; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function ruleEditor(r, index) {
  const id = index === -1 ? 'index' : `rule-${index}`;
  return `<div class="fields">
    <div><label for="${id}-domain">Code system</label><select id="${id}-domain" data-rule="${index}" data-key="domain">${Object.keys(DOMAINS).map(k => option(k, catalog.domains[k].label, r.domain)).join('')}</select></div>
    ${index === -1 ? `<div><label for="index-anchor">Index date</label><select id="index-anchor" data-field="indexOrder">${option('FIRST','First matching event in date range',definition.indexOrder)}${option('LAST','Last matching event in date range',definition.indexOrder)}</select></div>` : `<div><label for="${id}-mode">Eligibility rule</label><select id="${id}-mode" data-rule="${index}" data-key="mode">${option('INCLUDE','Include people with',r.mode)}${option('EXCLUDE','Exclude people with',r.mode)}</select></div>`}
    <div class="code-library-launch full"><div><strong>Choose codes by name</strong><p class="hint">Search descriptions, browse groups, and select codes for this event.</p></div><button class="button" data-browse="${index}">Browse codes</button></div>
    <div class="full"><label for="${id}-codes">${r.domain === 'NDC' ? '11-digit National Drug Codes' : 'Code list'}</label><textarea id="${id}-codes" data-rule="${index}" data-key="codes" rows="2" placeholder="${r.domain === 'DX' ? 'e.g. E11* or individual codes separated by commas' : r.domain === 'NDC' ? 'Enter 11-digit codes, preserving leading zeros' : 'Enter codes separated by commas'}">${esc(r.codes)}</textarea><p class="hint">${r.domain === 'NDC' ? 'Exact matches only. Hyphenated or 10-digit NDCs require conversion before entry.' : r.domain === 'DRG' ? (activeCdm()?"Exact three-digit DRG values with DRG_Type=2. Verify the applicable grouper year.":'Exact three-digit matches against the recorded DRG field, version 41.0. Preserve leading zeros.') : `Codes within this list use OR. A trailing * matches a prefix. Dots are ignored.${r.domain === 'DX' ? ' Only records marked ICD-10-CM are searched.' : ''}`}</p></div>
    <div class="full"><span class="field-label">Search these claim sources</span><div class="source-checks">${DOMAINS[r.domain].map(t => `<label class="check-row"><input type="checkbox" data-rule-source="${index}" value="${t}" ${r.sources.includes(t) ? 'checked' : ''}>${catalog.tables[t].label}</label>`).join('')}</div></div>
    ${activeCdm()&&r.domain!=='NDC'?`<div class="full"><span class="field-label">Encounter types</span><div class="source-checks">${Object.entries(cdm.ENC_TYPES).map(([value,label])=>`<label class="check-row"><input type="checkbox" data-enc-type="${index}" value="${value}" ${r.encTypes.includes(value)?'checked':''}>${value} · ${label}</label>`).join('')}</div><p class="hint">Uses EncType and ADate on this table, including records without a linked encounter.</p></div>`:''}
    ${index === -1 ? '' : `<div class="full fields three"><div><label for="${id}-from">From day</label><input id="${id}-from" type="number" min="${activeCdm()?-3650:-365}" max="${activeCdm()?3650:365}" value="${r.from}" data-rule="${index}" data-key="from"></div><div><label for="${id}-to">Through day</label><input id="${id}-to" type="number" min="${activeCdm()?-3650:-365}" max="${activeCdm()?3650:365}" value="${r.to}" data-rule="${index}" data-key="to"></div><div><label for="${id}-days">Minimum distinct days</label><input id="${id}-days" type="number" min="1" max="${activeCdm()?7301:366}" value="${r.minDays}" data-rule="${index}" data-key="minDays"></div></div><p class="hint full">Day 0 is the index date. Negative days precede index. Both endpoints are included.</p>`}
  </div>`;
}
function covariatePanel(){
  if(!activeCdm())return '';
  return panel('05','Baseline covariates','Select code-based features to calculate for every final cohort member.',`<p class="hint">Each feature becomes a binary cov_&lt;key&gt; flag and a distinct-event-day count in COHORT. Windows are relative to index and inclusive. Covariates describe the selected cohort; they do not change eligibility.</p>${definition.covariates.map((r,i)=>`<div class="rule"><div class="rule-head"><span class="rule-label">Covariate ${i+1} · ${esc(r.label||r.key)}</span><button type="button" data-cov-remove="${i}" aria-label="Remove covariate ${i+1}">×</button></div><div class="rule-body"><div class="fields"><div><label for="cov-${i}-key">SAS variable key</label><input id="cov-${i}-key" data-cov="${i}" data-key="key" value="${esc(r.key)}" maxlength="20" placeholder="e.g. diabetes"></div><div><label for="cov-${i}-label">Display label</label><input id="cov-${i}-label" data-cov="${i}" data-key="label" value="${esc(r.label)}" maxlength="80"></div><div><label for="cov-${i}-domain">Code system</label><select id="cov-${i}-domain" data-cov="${i}" data-key="domain">${Object.keys(cdm.DOMAINS).map(k=>option(k,cdm.catalog.domains[k].label,r.domain)).join('')}</select></div><div><label>Source table</label><div class="source-pill">${esc(cdm.catalog.tables[r.sources[0]].label)}</div></div><div class="full"><label for="cov-${i}-codes">Codes</label><textarea id="cov-${i}-codes" data-cov="${i}" data-key="codes" rows="2" placeholder="Codes separated by commas; * for a prefix">${esc(r.codes)}</textarea><button class="button small" type="button" data-cov-browse="${i}">Browse codes</button></div><div class="full"><span class="field-label">Encounter types</span><div class="source-checks">${r.domain==='NDC'?'<span class="hint">Not applicable to dispensing.</span>':Object.entries(cdm.ENC_TYPES).map(([value,label])=>`<label class="check-row"><input type="checkbox" data-cov-enc="${i}" value="${value}" ${r.encTypes.includes(value)?'checked':''}>${value} · ${label}</label>`).join('')}</div></div><div><label for="cov-${i}-from">From index day</label><input id="cov-${i}-from" type="number" min="-3650" max="3650" data-cov="${i}" data-key="from" value="${r.from}"></div><div><label for="cov-${i}-to">Through index day</label><input id="cov-${i}-to" type="number" min="-3650" max="3650" data-cov="${i}" data-key="to" value="${r.to}"></div><div><label for="cov-${i}-days">Minimum distinct days for flag</label><input id="cov-${i}-days" type="number" min="1" data-cov="${i}" data-key="minDays" value="${r.minDays}"></div></div></div></div>`).join('')||'<div class="empty">No code-based covariates selected yet.</div>'}<button class="add-rule" type="button" data-action="add-covariate" ${definition.covariates.length>=20?'disabled':''}>+ Add covariate</button>`);
}
function summary() {
  const errors = validateDefinition(definition);
  let count = 0;
  try { count = parseCodes(definition.index.codes, definition.index.domain).length; } catch { count = null; }
  return `<aside class="summary panel"><div class="summary-head"><p class="eyebrow">YOUR COHORT</p><div class="summary-title">${esc(definition.name || 'Untitled cohort')}</div><p class="hint">${esc(populationLabel())}</p></div><div class="summary-body">
    <div class="rule-count">${definition.rules.length + 1}<small>event criteria in this definition</small></div><hr>
    <dl><dt>Index code list</dt><dd>${count === null ? 'Check codes' : `${count} ${count === 1 ? 'code' : 'codes'}`}</dd><dt>${ageLabel()}</dt><dd>${definition.ageMin}–${definition.ageMax}</dd><dt>Enrollment</dt><dd>${definition.enrollment ? 'Required' : 'Optional'}</dd>${activeCdm()?`<dt>Covariates</dt><dd>${definition.covariates.length}</dd>`:''}<dt>Claim extracts</dt><dd>${definition.outputs.length} tables</dd></dl>
    <hr><h3>Enrollment window</h3>${!definition.enrollment ? '<p class="hint">Enrollment is not required.</p>' : `<div class="timeline" role="img" aria-label="${definition.baseline} days before index and ${definition.followup} days after index"><div class="base"></div><div class="index"><span>INDEX</span></div><div class="follow"></div><div class="ends"><span>−${definition.baseline} days</span><span>+${definition.followup} days</span></div></div>`}
    <div class="notice ${errors.length ? '' : 'info'}">${errors.length ? `<strong>Definition needs attention</strong><ul>${errors.slice(0, 3).map(e => `<li>${esc(e)}</li>`).join('')}</ul>${errors.length > 3 ? '<p>Review the definition for additional issues.</p>' : ''}` : '<strong>Definition ready to save</strong><br>Save it, then review the protocol and SAS program in Saved cohorts.'}</div>
    <hr><div class="status-row"><span class="status-dot"></span>Save this definition</div><p class="hint">Saved cohorts appear in your library. Open one there to view its tree, protocol, and SAS program.</p><button class="button primary full-button" data-action="save-cohort">Save cohort <span aria-hidden="true">→</span></button>
  </div></aside>`;
}
function mappingPanel() {
  const required = requiredTables(definition);
  return `<details class="panel"><summary class="details-toggle">SAS library and table mappings <span class="hint">· ${connectionIssues(definition).length} to configure</span></summary><div class="details-body"><p class="hint" style="margin-top:0;margin-bottom:18px">Dataset names vary by delivery. ${activeCdm()?'The defaults match the inspected 2013–2023 CDM files. {start} and {end} use the delivery years. {year} expands to every annual file. Verify mappings for other years.':`Enter two-level names for ${catalog.families[definition.family]} Set ${definition.edition}.`} The exported program stops if required mappings are missing.</p><div class="fields">
    ${field('Input folder, optional MS library', 'inputPath', definition.inputPath, 'text', 'placeholder="Use an existing libref, or enter a folder"')}
    ${field('Output folder, optional', 'outputPath', definition.outputPath, 'text', 'placeholder="Defaults to the SAS WORK library"')}
    ${required.map(t => `<div><label for="map-${t}">${t} · ${catalog.tables[t].label}</label><input id="map-${t}" data-map="${t}" value="${esc(definition.mapping[t])}" placeholder="LIBREF.TABLE" spellcheck="false" autocomplete="off">${activeCdm()?`<p class="hint" data-map-preview="${t}">${esc(mappingPreview(t))}</p>`:''}</div>`).join('')}
    </div><p class="hint">Use a fresh output library for each run. Input MS is assigned read-only when a folder is provided. Existing output tables are protected from replacement.</p></div></details>`;
}
function mappingPreview(t){
  if(!Number.isInteger(definition.yearStart)||!Number.isInteger(definition.yearEnd)||definition.yearEnd<definition.yearStart||definition.yearEnd-definition.yearStart>=100)return 'Enter the delivery years to preview filenames.';
  const rows=cdm.expandMapping(definition,t);
  return rows.length>1?`${rows[0].dataset} … ${rows.at(-1).dataset} (${rows.length} files)`:rows[0].dataset;
}
function populationFields(){
  const c=activeCdm(), min=c?`${definition.yearStart}-01-01`:'2023-01-01', max=c?`${definition.yearEnd}-12-31`:'2023-12-31';
  return `<div class="fields"><div class="full">${field('Cohort name','name',definition.name)}</div>
    ${c?`${number('Delivery start year','yearStart',definition.yearStart,1900,2100)}${number('Delivery end year','yearEnd',definition.yearEnd,1900,2100)}<p class="hint full">The inspected CDM delivery covers 2013–2023. Verify table names and fields before selecting other years. Each annual clinical table is required for every selected delivery year.</p>`:`<div><label for="family">Database</label><select id="family" data-field="family">${Object.entries(catalog.families).map(([k,v])=>option(k,v,definition.family)).join('')}</select></div><div><label for="edition">Delivery edition</label><select id="edition" data-field="edition">${option('A','Set A',definition.edition)}${option('B','Set B',definition.edition)}</select></div>`}
    ${field('Index dates from','start',definition.start,'date',`min="${min}" max="${max}"`)}${field('Through','end',definition.end,'date',`min="${min}" max="${max}"`)}
    <div class="full fields three">${number(`Minimum ${ageLabel().toLowerCase()}`,'ageMin',definition.ageMin,0,c?120:100)}${number(`Maximum ${ageLabel().toLowerCase()}`,'ageMax',definition.ageMax,0,c?120:100)}
    <div><label for="sex">Recorded sex</label><select id="sex" data-field="sex">${option('ALL','Any / all recorded values',definition.sex)}${(c?[['M','Male'],['F','Female'],['A','Ambiguous'],['U','Unknown']]:[['1','Male'],['2','Female']]).map(([value,label])=>option(value,label,definition.sex)).join('')}</select></div></div>
    <p class="hint full">${c?'Age is completed years from the recorded Birth_Date at the selected index date. Missing or future birth dates are excluded. SAS retains the source PatID type and checks it across required tables.':'Age follows MarketScan reporting conventions. The 2023 maximum of 100 includes ages 100 and older. Missing ages are excluded.'}</p></div>`;
}
function cdmCodebook(){
  return `<div class="stack">${panel('CDM','Mini-Sentinel Common Data Model','Version 3.0 · Institutional source layout',`<p class="review-summary-text">The supplied Mini-Sentinel dictionary defines the CDM concepts. The live 2013–2023 delivery inventory supplies the actual table names and field types, including numeric PatID and annual names without an underscore before the year. SAS checks every required file and field before selection.</p><p class="hint">Source document · Mini-Sentinel_Common-Data-Model.pdf, supplied with this project. The source PDF and live inventory stay local.</p>`)}
    <section class="panel"><div class="panel-head"><div><h2>Institutional tables</h2><p>The MS library is configurable in SAS. Filename tokens use your delivery years.</p></div></div><div class="table-wrap"><table><thead><tr><th>Table</th><th>Filename pattern</th><th>Fields used by this engine</th><th>Dictionary page</th></tr></thead><tbody>${TABLES.map(t=>`<tr><td>${catalog.tables[t].label}</td><td><code>${catalog.tables[t].pattern}</code></td><td><code>${catalog.tables[t].fields}</code></td><td>${catalog.tables[t].page}</td></tr>`).join('')}</tbody></table></div></section>
    ${panel('i','Selection conventions','Rules derived from the supplied CDM dictionary.',`<div class="catalog-note"><h3>Enrollment rollup</h3><p>The institutional rollup must expose PatID, Enr_Start, Enr_End, MedCov, and DrugCov with their documented types. SAS stops if that contract differs. Medical coverage requires MedCov=Y. Optional drug coverage additionally requires DrugCov=Y.</p></div><div class="catalog-note"><h3>Independent clinical records</h3><p>Diagnosis and Procedure use their own ADate and EncType. Orphan records remain eligible. Age uses Demographic.Birth_Date. Death records are available as an optional extract and do not change enrollment or eligibility.</p></div><div class="catalog-note"><h3>Code systems and years</h3><p>ICD-9 and ICD-10 use distinct code-type filters. The v3.0 dictionary labels procedure type 10 as ICD-10-CM. This engine treats it as the ICD-10 procedure slot and additionally requires a seven-character PCS value. Confirm that convention with the delivery. Bundled menus cover 2023 only. Earlier code descriptions require local catalogs or manual entry, and MS-DRG versions require year-specific review.</p></div>${Object.entries(catalog.domains).map(([,v])=>`<div class="catalog-note"><h3>${v.label}</h3><p>${esc(v.matching)}</p></div>`).join('')}`)}
  </div>`;
}
function workflowPanel(){
  if(!activeCdm())return '';
  return panel('07','SAS checkpoints and add-on code','Run to a checkpoint, review counts, then revise and continue in a fresh session.',`<div class="fields"><div><label for="stopAfter">Run through</label><select id="stopAfter" data-field="stopAfter">${[['INDEX','Index selection'],['ELIGIBILITY','Eligibility and conditions'],['DELIVER','Final data cut']].map(([v,label])=>option(v,label,definition.stopAfter)).join('')}</select></div></div><p class="hint">Each stage reports total people and index dates in SAS. WORK._RG_COHORT feeds the next stage. No outcome counts are stratified by exposure.</p><div class="addon-field"><label for="afterIndexSas">SAS code after index selection</label><textarea id="afterIndexSas" data-field="afterIndexSas" spellcheck="false" placeholder="Optional SAS statements that use WORK._RG_COHORT">${esc(definition.afterIndexSas)}</textarea><p class="hint">Runs before demographics, enrollment, and other criteria.</p></div><div class="addon-field"><label for="afterEligibilitySas">SAS code after eligibility</label><textarea id="afterEligibilitySas" data-field="afterEligibilitySas" spellcheck="false" placeholder="Optional SAS statements that use WORK._RG_COHORT">${esc(definition.afterEligibilitySas)}</textarea><p class="hint">Runs before final output tables are written. Review all add-on code before execution.</p></div>`);
}
function connectionPanel(){
  if(!activeCdm())return '';
  return panel('08','Local SAS/CONNECT','The generated runner starts in local SAS and submits the CDM work to the server.',`<div class="fields"><div><label for="connect-host">Server hostname</label><input id="connect-host" data-connect="host" value="${esc(connectSettings.host)}" autocomplete="off" placeholder="Enter your reachable SAS server"></div><div><label for="connect-port">Port</label><input id="connect-port" data-connect="port" type="number" min="1" max="65535" value="${esc(connectSettings.port)}"></div><div class="full"><label for="connect-script">Local SAS link script</label><input id="connect-script" data-connect="script" value="${esc(connectSettings.script)}" spellcheck="false"></div><div class="full"><label for="connect-results-folder">Existing local folder for results CSVs</label><input id="connect-results-folder" data-connect="resultsFolder" value="${esc(connectSettings.resultsFolder)}" spellcheck="false" placeholder="C:\\Users\\...\\private-results"></div><label class="check-row full"><input type="checkbox" data-connect="includeCohort" ${connectSettings.includeCohort?'checked':''}>Also export the complete row-level COHORT CSV to that local folder</label></div><p class="hint">Connection settings stay on this device and are omitted from cohort JSON. The SAS sign-on script requests your credentials locally. For persistent results, enter a new one-level output directory under your approved /storage/storage1/PHShome/&lt;username&gt; home in the mappings panel. The runner creates that directory. The separate results exporter reads that completed folder and writes CSVs only into your chosen local folder.</p>`);
}
function builder() {
  return `<div class="builder-grid"><div class="stack">
    ${panel('01', 'Population', 'Choose the source population and index date range.', populationFields())}
    ${panel('02', 'Index event', 'The selected matching event establishes each person’s index date.', ruleEditor(definition.index,-1) + '<p class="hint" style="margin-top:15px">Demographics and subsequent rules apply after the index event is selected. Other candidate events do not replace an ineligible selected event.</p>')}
    ${panel('03', 'Eligibility criteria', 'Criteria follow the AND/OR grouping in the cohort tree.', `<div class="logic-summary"><strong>${esc(logicText(treeFor(definition)))}</strong><button class="button small" data-action="graph">Edit condition tree</button></div>${definition.rules.length ? definition.rules.map((r,i)=>`<div class="rule"><div class="rule-head"><span class="rule-label"><span class="logic ${r.mode==='EXCLUDE'?'exclude':''}">${r.mode === 'INCLUDE' ? 'INCLUDE' : 'EXCLUDE'}</span> &nbsp; Criterion ${i+1}</span><button aria-label="Remove criterion ${i+1}" data-remove="${i}">×</button></div><div class="rule-body">${ruleEditor(r,i)}</div></div>`).join(`<div class="and-line">${usesOr(treeFor(definition))?'TREE CRITERION':'AND'}</div>`) : '<div class="empty">Add diagnoses, procedures, or medications to refine the population.<br>Each criterion can have its own window relative to index.</div>'}<button class="add-rule" data-action="add-rule" ${definition.rules.length>=20?'disabled':''}>+ Add eligibility criterion</button>`)}
    ${panel('04', 'Enrollment & observation', 'Set how much observable time each person needs around index.', `<label class="check-row" style="margin-bottom:20px"><input type="checkbox" data-field="enrollment" ${definition.enrollment?'checked':''}>Require ${activeCdm()?'medical coverage (MedCov=Y)':'continuous enrollment'} across the observation window</label><div class="fields three">${number('Days before index','baseline',definition.baseline)}${number('Days after index','followup',definition.followup)}${number('Maximum internal gap','gap',definition.gap)}</div><p class="hint">The window includes index day. Coverage must reach both endpoints. Each internal gap may be at most the selected number of days.</p><label class="check-row" style="margin-top:18px"><input type="checkbox" data-field="rx" ${definition.rx?'checked':''} ${!definition.enrollment?'disabled':''}>Require ${activeCdm()?'drug coverage (DrugCov=Y)':'pharmacy capture'} throughout the covered intervals</label>`)}
    ${covariatePanel()}
    ${panel('06', 'Data cut', 'Keep one cohort row per person and select the related records to extract.', `<div class="fields">${TABLES.map(t=>`<label class="output-item ${definition.outputs.includes(t)?'selected':''}"><input type="checkbox" data-output="${t}" ${definition.outputs.includes(t)?'checked':''}><span class="table-code">${t}</span><span>${catalog.tables[t].label}<small>${activeCdm()?catalog.tables[t].extract:t==='T'?'Intervals overlapping the cut window':t==='I'?'Selected by admission date':'Selected by service date'}</small></span></label>`).join('')}</div><div class="fields" style="margin-top:21px">${number('Extract days before index','extractBefore',definition.extractBefore)}${number('Extract days after index','extractAfter',definition.extractAfter)}</div><p class="hint">At final delivery, the cohort, attrition table, and definition are included. Claim extracts preserve the original fields and add the index date. Enrollment records preserve their original endpoints. ${activeCdm()?'Annual extracts remain in separate files. Demographic and Death extracts include all records for selected people. Death dates do not change enrollment.':''}</p>`)}
    ${mappingPanel()}
    ${workflowPanel()}
    ${desktop?'':connectionPanel()}
    ${panel('09','Save cohort','Add this definition to the saved cohort library.',`<button class="button primary" data-action="save-cohort">Save cohort</button><p class="hint">Open Saved cohorts to review the condition tree, study population protocol, and downloadable SAS code.</p>`)}
  </div><div id="summary-container">${summary()}</div></div>`;
}
function review() {
  const errors=validateDefinition(definition), mappingIssues=connectionIssues(definition);
  const rules=[{...definition.index,mode:'INDEX'},...definition.rules];
  const code=errors.length ? 'Resolve definition issues to generate the SAS program.' : compileSas(definition,engine);
  return `<div class="review-grid"><div class="stack">${panel('01','Review the definition','Check the population, temporal logic, and requested records.', `<p class="review-summary-text">${esc(definition.name)} selects people in <strong>${esc(populationLabel())}</strong> with the ${definition.indexOrder==='LAST'?'last':'first'} matching event between <strong>${fmtDate(definition.start)}</strong> and <strong>${fmtDate(definition.end)}</strong>. ${ageLabel()} must be <strong>${definition.ageMin}–${definition.ageMax}</strong>. ${definition.enrollment ? `Enrollment must cover ${definition.baseline} days before and ${definition.followup} days after index, with internal gaps of at most ${definition.gap} days.` : 'Enrollment is not an eligibility requirement.'} ${definition.sex==='ALL'?'All recorded sex values are accepted.':`Recorded sex must equal ${esc(definition.sex)}.`} ${activeCdm()&&definition.enrollment?'Covered intervals require MedCov=Y.':''} ${definition.rx?(activeCdm()?'Covered intervals also require DrugCov=Y.':'Covered intervals must have pharmacy capture.'):''}</p><p class="review-summary-text">${definition.outputs.length ? `Extract ${definition.outputs.join(', ')}. Clinical records span ${definition.extractBefore} days before through ${definition.extractAfter} days after index. ${activeCdm()?'Demographic and Death include all selected-person records. Annual files remain separate.':''}` : 'Export the cohort and audit tables only.'}</p><div class="logic-summary"><strong>${esc(logicText(treeFor(definition)))}</strong><button class="button small" data-action="graph">Edit tree</button></div>${rules.map((r,i)=>`<div class="review-rule"><span class="step-number">${i+1}</span><div><h3>${r.mode==='INDEX'?'Index event':r.mode==='INCLUDE'?'Required event':'Exclusion event'} · ${catalog.domains[r.domain].label}</h3><p>${r.sources.map(t=>catalog.tables[t].label).join(', ')}${activeCdm()&&r.domain!=='NDC'?` · EncType ${r.encTypes.join(', ')}`:''}</p>${i?`<p>At least ${r.minDays} distinct day${r.minDays===1?'':'s'} from day ${r.from} through day ${r.to}, inclusive.</p>`:`<p>${definition.indexOrder==='LAST'?'Last':'First'} observed match within the index date range.</p>`}<div>${esc(r.codes).split(/[\s,;]+/).filter(Boolean).slice(0,30).map(c=>`<span class="code-chip">${c}</span>`).join('')}${r.codes.split(/[\s,;]+/).filter(Boolean).length>30?'<span class="hint">More codes are included in the program.</span>':''}</div></div></div>`).join('')}`)}
    ${errors.length?`<div class="notice error"><strong>Resolve these definition issues</strong><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`:''}
    ${mappingPanel()}
    <details class="panel"><summary class="details-toggle">Study population selection protocol</summary><pre class="protocol-preview">${esc(selectionProtocol(definition,catalog))}</pre></details>
    <section class="panel"><div class="panel-head"><div><h2>Generated SAS program</h2><p>The full extraction logic is included in the download.</p></div></div><pre class="code-preview" tabindex="0" aria-label="Generated SAS program">${esc(code)}</pre></section>
    <section class="panel"><div class="panel-head"><div><h2>Cohort attrition</h2><p>Counts will be produced by SAS after execution.</p></div></div><table><thead><tr><th>Selection step</th><th>People remaining</th></tr></thead><tbody><tr><td>${definition.indexOrder==='LAST'?'Last':'First'} matching index event</td><td>Awaiting SAS run</td></tr><tr><td>Demographic requirements</td><td>Awaiting SAS run</td></tr>${definition.enrollment?'<tr><td>Enrollment requirements</td><td>Awaiting SAS run</td></tr>':''}${usesOr(treeFor(definition))?'<tr><td>Combined AND/OR condition tree</td><td>Awaiting SAS run</td></tr>':definition.rules.map((r,i)=>`<tr><td>Criterion ${i+1} · ${r.mode==='INCLUDE'?'Inclusion':'Exclusion'}</td><td>Awaiting SAS run</td></tr>`).join('')}</tbody></table><div class="panel-body"><p class="hint">Final delivery also writes covariate prevalence, index-month and age-band counts, missingness, extract counts, and a 200-row cohort preview. Open the completed CSVs in Diagnostics.</p><button class="button small" data-action="diagnostics">Open diagnostics</button></div></section>
  </div><aside class="summary panel"><div class="summary-head"><p class="eyebrow">EXPORT PACKAGE</p><h2>Ready for your SAS workspace.</h2></div><div class="summary-body"><p class="review-summary-text" style="font-size:14px">A self-contained SAS 9.4 program with the cohort rules, code lists, selection steps, and requested extracts.</p>${mappingIssues.length?`<div class="notice mapping-notice"><strong>${mappingIssues.length} table mappings remain</strong><br>${activeCdm()?'Fill in the mappings in the builder and regenerate the program.':'You can download now and fill in the mappings in the program.'} SAS stops until mappings are supplied.</div>`:'<div class="notice info mapping-notice">Table names are configured. Confirm their delivery and year range before running.</div>'}<button class="button primary full-button" data-action="export-sas" ${errors.length?'disabled':''}>Download SAS program ↓</button><button class="button full-button" data-action="export-json">Download definition</button><button class="button full-button" data-action="export-protocol">Download selection protocol</button><button class="button subtle full-button" data-action="builder">Back to definition</button><hr><p class="export-meta">The SAS 9.4 synthetic check and institutional schema preflight passed. Review each definition-specific run and its diagnostics.</p><p class="hint">For a first check, ${activeCdm()?'<a href="./synthetic_cdm_fixture.sas?v=d6e53643d0f2" download>download the CDM SAS check</a>':'<a href="./synthetic_fixture.sas?v=d6e53643d0f2" download>download the synthetic SAS check</a> and the <a href="./synthetic_tree_fixture.sas?v=d6e53643d0f2" download>nested tree check</a>'}. Run each in a separate fresh SAS session before using research data.</p></div></aside></div>`;
}
function codebook() {
  if(activeCdm())return cdmCodebook();
  return `<div class="stack">${panel('2023','Commercial & Medicare data dictionary','Version 1.0 · Verified against the vendor’s 2023 dictionary and user guide.',`<p class="review-summary-text">This release uses a single, explicit schema for 2023. Additional codebooks can be added as separate year profiles without changing saved definitions.</p><div class="toolbar"><a class="button" href="${catalog.dictionaryUrl}" target="_blank" rel="noreferrer">Open data dictionary ↗</a><a class="button" href="${catalog.guideUrl}" target="_blank" rel="noreferrer">Open user guide ↗</a></div>`)}<section class="panel"><div class="panel-head"><div><h2>Tables behind the cohort builder</h2><p>Table letters are source definitions. Your SAS dataset names are configured separately.</p></div></div><div class="table-wrap"><table><thead><tr><th>Table</th><th>Records</th><th>Date used</th><th>Diagnosis fields searched</th><th>Dictionary</th></tr></thead><tbody>${TABLES.map(t=>`<tr><td><code>${t}</code></td><td>${catalog.tables[t].label}</td><td><code>${catalog.tables[t].date}${t==='T'?' / DTEND':''}</code></td><td><code>${catalog.tables[t].diagnoses?.join(', ')||'Not used for diagnoses'}</code></td><td><a href="${catalog.dictionaryUrl}#page=${catalog.tables[t].page}" target="_blank" rel="noreferrer">Page ${catalog.tables[t].page}</a></td></tr>`).join('')}</tbody></table></div></section>${panel('i','Interpretation notes','Source-specific details that affect cohort definitions.',catalog.notes.map(n=>`<div class="catalog-note"><h3>${n.title}</h3><p>${n.text}</p><a href="${n.source==='dictionary'?catalog.dictionaryUrl:catalog.guideUrl}#page=${n.page}" target="_blank" rel="noreferrer">${n.source==='dictionary'?'Dictionary':'User guide'} · PDF page ${n.page} ↗</a></div>`).join(''))}</div>`;
}
function activeProfile(){return profiles.find(profile=>profile.id===activeProfileId);}
function persistProfiles(){
  const current=activeProfile();
  if(current){
    const next=profileFromSettings(current,desktopSettings,connectSettings);
    profiles[profiles.findIndex(profile=>profile.id===activeProfileId)]=next;
  }
  localStorage.setItem(PROFILE_KEY,JSON.stringify({profiles,activeId:activeProfileId}));
}
function useProfile(profile){
  activeProfileId=profile.id;
  desktopSettings={sasExecutable:profile.sasExecutable,serverUser:profile.serverUser,outputParent:profile.outputParent};
  connectSettings={host:profile.host,port:profile.port,script:profile.script,resultsFolder:profile.resultsFolder,includeCohort:profile.includeCohort};
  connectionCheck=null;
  sasPathCheck=null;
}
function freshRunPath(){
  const parent=parseOutputParent(desktopSettings.outputParent,desktopSettings.serverUser);
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','_').replace('.','_').replace('Z','');
  definition.outputPath=`${parent}/roger_${stamp}_${crypto.randomUUID().slice(0,4)}`;
  if(!definition.inputPath)definition.inputPath=desktopSourcePath;
}
function saveCohort({stay=false,asNew=false}={}){
  try{
    if(!definition.name.trim())throw new Error('Name the cohort before saving.');
    const result=upsertSavedCohort(savedCohorts,asNew?'':selectedSavedCohortId,definition);
    localStorage.setItem(SAVED_COHORTS_KEY,JSON.stringify(result.items));
    savedCohorts=result.items;selectedSavedCohortId=result.cohort.id;
    localStorage.setItem(activeCdm()?DRAFT_KEY:LEGACY_DRAFT_KEY,JSON.stringify(definition));
    cohortDirty=false;document.querySelector('#save-state').textContent='Saved on this device';
    if(stay)render();else setView('saved');
    toast('Cohort saved to your library.');
  }catch(error){toast(`Cohort could not be saved. ${error.message}`);}
}
function selectSavedCohort(id){
  const item=savedCohorts.find(entry=>entry.id===id);
  if(!item)throw new Error('That saved cohort is unavailable.');
  selectedSavedCohortId=id;definition=readDefinition(item.definition);if(desktop&&activeCdm())definition.inputPath=desktopSourcePath;selectedRunCohortId='';
  cohortDirty=false;document.querySelector('#save-state').textContent='Saved on this device';render();
}
async function checkDesktopConnection(){
  try{
    connectionCheck={ok:null,message:'Checking the SAS/CONNECT host and port…'};render();
    connectionCheck=await desktop.checkConnection({host:connectSettings.host,port:connectSettings.port});
    render();
  }catch(error){connectionCheck={ok:false,message:error.message};render();}
}
function profileIssues(){
  const issues=[];
  if(!desktopSettings.sasExecutable)issues.push('Select your local SAS 9.4 sas.exe.');
  else if(!sasPathCheck?.ok)issues.push(sasPathCheck?.message||'Validate the local SAS executable.');
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(desktopSettings.serverUser))issues.push('Enter your own server username.');
  try{parseOutputParent(desktopSettings.outputParent,desktopSettings.serverUser);}catch(error){issues.push(error.message);}
  if(!connectSettings.host)issues.push('Enter the institutional SAS/CONNECT hostname.');
  if(!Number.isInteger(Number(connectSettings.port))||Number(connectSettings.port)<1||Number(connectSettings.port)>65535)issues.push('Enter the SAS/CONNECT port.');
  if(!/^[A-Za-z]:\\[^\r\n;]*\.scr$/i.test(connectSettings.script))issues.push('Select a local SAS link script ending in .scr.');
  return issues;
}
async function validateSasPath(){
  if(!desktop)return;
  const candidate=desktopSettings.sasExecutable;
  sasPathCheck={ok:null,message:'Checking SAS executable…'};
  if(view==='profile')render();
  try{const result=await desktop.validateSas(candidate);if(candidate===desktopSettings.sasExecutable)sasPathCheck=result;}
  catch(error){if(candidate===desktopSettings.sasExecutable)sasPathCheck={ok:false,message:error.message};}
  if(view==='profile'||view==='run')render();
}
function profileWorkspace(){
  if(!desktop)return panel('i','Desktop app required','Profiles are available in the installed ROGER app.','<p>The browser preview can save cohorts and download SAS programs.</p>');
  const profile=activeProfile(),busy=desktopJob?.status==='running';
  const guide=`<details class="setup-guide" ${profileIssues().length?'open':''}><summary>New here? Set up your investigator profile</summary><ol><li>Install SAS 9.4 with SAS/CONNECT and connect to your institution’s VPN.</li><li>Choose your local <code>sas.exe</code>, then enter your own server username and SAS/CONNECT host, port, and link script.</li><li>Set an existing output parent under your own server home and choose an existing protected Windows results folder.</li><li>Save your profile, check the VPN/server connection, and run the local synthetic SAS check.</li><li>Build and save a cohort. On Run in SAS, deliberately select this profile and a saved cohort.</li></ol><p class="hint">SAS prompts for credentials at sign-on; ROGER does not save passwords. A reachable port does not confirm account authorization.</p></details>`;
  const picker=panel('01','Investigator profiles','Each profile stores this computer’s SAS and connection settings.',`<div class="fields"><div><label for="profile-select">Profile to edit</label><select id="profile-select" data-profile-select>${profiles.map(item=>option(item.id,item.name,activeProfileId)).join('')}</select></div><div><label for="profile-name">Profile name</label><input id="profile-name" data-profile-name value="${esc(profile?.name||'')}" maxlength="60"></div></div><div class="run-actions"><button class="button" data-action="add-profile">Create profile</button><button class="button" data-action="save-profile">Save profile</button><button class="button subtle" data-action="delete-profile" ${profiles.length<2?'disabled':''}>Delete profile</button></div><p class="hint">Profiles are local to this Windows account. Each team member should use their own server account and approved output home.</p>`);
  const setup=panel('02','SAS and server connection','Locate the local SAS executable and enter the details for SAS/CONNECT.',`<div class="fields"><div class="full"><label for="desktop-sas">Local SAS 9.4 executable</label><div class="desktop-path"><input id="desktop-sas" data-desktop="sasExecutable" value="${esc(desktopSettings.sasExecutable)}" spellcheck="false" placeholder="C:\\Program Files\\SASHome\\SASFoundation\\9.4\\sas.exe"><button class="button" data-action="choose-sas">Browse</button><button class="button" data-action="validate-sas">Check path</button></div><p class="hint" id="sas-path-status" role="status">${esc(sasPathCheck?.message||'Browse to sas.exe, then check the path.')}</p></div><div><label for="desktop-user">Your server username</label><input id="desktop-user" data-desktop="serverUser" value="${esc(desktopSettings.serverUser)}" placeholder="Your institutional ID" autocomplete="username"></div><div><label for="run-host">SAS/CONNECT hostname</label><input id="run-host" data-connect="host" value="${esc(connectSettings.host)}"></div><div><label for="run-port">SAS/CONNECT port</label><input id="run-port" data-connect="port" type="number" min="1" max="65535" value="${esc(connectSettings.port)}"></div><div class="full"><label for="run-script">Local SAS link script (.scr)</label><input id="run-script" data-connect="script" value="${esc(connectSettings.script)}" spellcheck="false"></div><div class="full"><label for="run-parent">Server output parent (existing directory)</label><input id="run-parent" data-desktop="outputParent" value="${esc(desktopSettings.outputParent)}" spellcheck="false" placeholder="/storage/storage1/PHShome/yourid"></div><div class="full"><label for="run-results">Existing protected Windows folder for result CSVs</label><div class="desktop-path"><input id="run-results" data-connect="resultsFolder" value="${esc(connectSettings.resultsFolder)}" spellcheck="false"><button class="button" data-action="choose-results">Browse</button></div></div><label class="check-row full"><input type="checkbox" data-connect="includeCohort" ${connectSettings.includeCohort?'checked':''}>Also export the complete row-level COHORT CSV with identifiers</label></div><div class="run-actions"><button class="button" data-action="check-connection" ${busy?'disabled':''}>Check VPN / server connection</button><button class="button" data-action="run-synthetic" ${busy||!sasPathCheck?.ok?'disabled':''}>Run local synthetic SAS check</button></div>${connectionCheck?`<div class="notice ${connectionCheck.ok?'info':''}" role="status">${esc(connectionCheck.message)}</div>`:'<p class="hint">If the server cannot be reached, connect to the institutional VPN and retry. SAS requests your credentials when a server job starts.</p>'}<p class="hint">CDM source: <code>${esc(desktopSourcePath)}</code> (read-only). Persistent run folders are created only under each investigator’s own server home.</p>`);
  return `<div class="stack">${guide}${picker}${setup}</div>`;
}
function runWorkspace(){
  if(!desktop)return panel('i','Desktop app required','Install ROGER to run SAS.','<p>Saved cohorts in the browser can still provide a protocol and downloadable SAS program.</p>');
  const profile=profiles.find(item=>item.id===selectedRunProfileId);
  const cohort=savedCohorts.find(item=>item.id===selectedRunCohortId);
  let runFolderReady=false,folderIssue='';
  try{const folder=parseRunFolder(definition.outputPath);if(folder.user!==desktopSettings.serverUser)throw new Error('The run folder must be under the selected profile’s server username.');runFolderReady=true;}catch(error){folderIssue=error.message;}
  const issues=[...(!profile?['Choose an investigator profile.']:profileIssues()),...(!cohort?['Choose a saved cohort.']:[]),...(cohort&&validateDefinition(definition).length?validateDefinition(definition):[]),...(activeCdm()&&definition.inputPath!==desktopSourcePath?['The CDM input must be the configured read-only institutional source.']:[]),...(!runFolderReady?[folderIssue]:[])];
  const busy=desktopJob?.status==='running';
  const select=panel('01','Choose what to run','Select a saved cohort and an investigator profile for this SAS job.',`<div class="fields"><div><label for="run-cohort-select">Saved cohort</label><select id="run-cohort-select" data-run-cohort-select>${option('','Choose a saved cohort',selectedRunCohortId)}${savedCohorts.map(item=>option(item.id,item.name,selectedRunCohortId)).join('')}</select></div><div><label for="run-profile-select">Investigator profile</label><select id="run-profile-select" data-run-profile-select>${option('','Choose an investigator profile',selectedRunProfileId)}${profiles.map(item=>option(item.id,item.name,selectedRunProfileId)).join('')}</select></div></div><p class="hint">The selected profile supplies your local SAS 9.4 executable, server account, SAS/CONNECT settings, and approved output parent. <button class="text-link" data-action="profile">Edit profiles</button></p>${cohort?`<div class="notice info">${esc(cohort.name)} · ${esc(logicText(treeFor(definition)))}</div>`:''}`);
  const actions=panel('02','Run in SAS','ROGER launches local SAS, then SAS/CONNECT signs on to the server.',`<div class="fields"><div class="full"><label for="run-output">New server run folder</label><div class="desktop-path"><input id="run-output" data-field="outputPath" value="${esc(definition.outputPath)}" spellcheck="false" placeholder="Select profile and cohort, then choose New name"><button class="button" data-action="new-run-folder" ${!profile?'disabled':''}>New name</button></div><p class="hint">Each cohort cut uses a fresh child folder under your own approved server home. The CDM input folder is read-only.</p></div></div><div class="notice ${issues.length?'':'info'}">${issues.length?`<strong>Complete these choices before running</strong><ul>${issues.slice(0,8).map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:'<strong>Ready to run the saved cohort.</strong>'}</div><div class="run-actions"><button class="button primary" data-action="run-cohort" ${busy||issues.length?'disabled':''}>Run cohort cut in SAS</button><button class="button" data-action="run-results" ${busy||issues.length?'disabled':''}>Export completed results</button><button class="button" data-action="run-preview" ${busy||issues.length?'disabled':''}>Print 100-row preview</button><button class="button" data-action="load-desktop-results" ${busy||!profile||!connectSettings.resultsFolder?'disabled':''}>Load result CSVs</button></div><p class="hint">Result export and PROC PRINT read an already completed server run. Review job status and log below before opening Data preview or Diagnostics.</p>`);
  const log=panel('03','SAS job and live log','Output appears here as the local SAS process writes it.',`<div class="job-state" id="job-state"><strong>${esc(desktopJob?.status||'No job started')}</strong>${desktopJob?` · ${esc(desktopJob.kind)} · ${esc(desktopJob.startedAt||'')}`:''}</div>${desktopJob?`<p class="hint">Local job folder: <code>${esc(desktopJob.folder||'')}</code></p><button class="button small" data-action="open-job-folder">Open job folder</button><pre class="job-log" tabindex="0">${esc(desktopJob.log||'Waiting for SAS output. If SAS opens a TYPE WINDOW sign-on prompt, enter your credentials there.')}</pre>`:'<p class="hint">Choose a saved cohort and a profile above. The SAS log will appear here while the job runs.</p>'}`);
  return `<div class="stack">${select}${actions}${log}</div>`;
}
function savedWorkspace(){
  const selected=savedCohorts.find(item=>item.id===selectedSavedCohortId);
  const cards=panel('01','Saved cohort library','Open a cohort to visualize its criteria, review the protocol, and download its SAS program.',`<div class="run-actions"><button class="button" data-action="new-cohort">New cohort</button><button class="button primary" data-action="save-cohort">Save current cohort</button></div>${savedCohorts.length?`<div class="saved-list">${savedCohorts.map(item=>`<div class="saved-card ${selected?.id===item.id?'chosen':''}"><button data-saved-open="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${esc(item.definition.schemaId.includes('mini-sentinel')?'Mini-Sentinel CDM':'MarketScan 2023')} · ${item.definition.rules.length+1} event criteria · ${new Date(item.updatedAt).toLocaleString()}</span><small>${esc(logicText(treeFor(item.definition)))}</small></button><button class="button small subtle" data-saved-delete="${esc(item.id)}" aria-label="Delete ${esc(item.name)}">Delete</button></div>`).join('')}</div>`:'<div class="empty">No saved cohorts yet. Build a cohort and choose Save cohort.</div>'}`);
  if(!selected)return `<div class="stack">${cards}</div>`;
  return `<div class="stack">${cards}${panel('02',`Viewing ${esc(selected.name)}`,'The graphical tree and notes below come from this saved cohort.',`<div class="run-actions"><button class="button" data-action="edit-saved">Edit definition</button><button class="button" data-action="save-cohort">Save changes</button>${desktop?`<button class="button primary" data-action="run-saved" ${cohortDirty?'disabled':''}>Select for SAS run</button>`:''}</div>`)}${cohortDirty?'<div class="notice">The current edits are not saved. Save changes before reviewing or downloading this cohort.</div>':''}${renderTree(definition,catalog,!cohortDirty,validateDefinition(definition).length)}${cohortDirty?'':review()}</div>`;
}
function resultsToolbar(){
  return `<div class="results-toolbar"><div><h2>Completed SAS results</h2><p class="hint">Print the first 100 rows in local SAS Results, or run the results exporter and open its CSV files here. Imported files stay in this browser tab.</p></div><div class="results-actions">${activeCdm()?'<button class="button" data-action="export-print-preview">Download 100-row PROC PRINT</button><button class="button" data-action="export-results">Download SAS results exporter</button>':''}<button class="button primary" data-action="open-results">Open SAS CSV files</button></div></div>${resultTables.size?`<div class="results-file-list">${[...resultTables].map(([name,t])=>`<span class="result-chip"><strong>${esc(name)}</strong> · ${t.rows.length.toLocaleString()} rows <button type="button" data-result-remove="${esc(name)}" aria-label="Remove ${esc(name)}">×</button></span>`).join('')}</div>`:''}`;
}
function activeResult(){return resultTables.get(selectedResult);}
function resultsEmpty(){return `<section class="panel"><div class="panel-body"><h2>No results loaded</h2><p>Run the generated SAS/CONNECT cohort program, then download and run the SAS results exporter. Enter the existing local CSV folder in the builder first. Open the generated CSV files above to inspect rows and diagnostics here.</p><p class="hint">The browser never connects to the institutional CDM or uploads your files. SAS produces the full-cohort diagnostics in the completed run folder.</p></div></section>`;}
function tableMarkup(columns,rows){return `<div class="table-wrap results-table"><table><thead><tr>${columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${columns.length}">No rows</td></tr>`}</tbody></table></div>`;}
function preview(){
  const table=activeResult();
  if(!table)return `<div class="stack">${resultsToolbar()}${resultsEmpty()}</div>`;
  const cols=resultState.visible||new Set(table.columns),page=previewRows(table,resultState),profiles=missingness(table,{search:resultState.search});
  return `<div class="stack">${resultsToolbar()}<section class="panel"><div class="panel-head"><div><h2>Data preview</h2><p>Explore imported rows. ${selectedResult==='cohort_preview'?'This SAS preview is capped at 200 selected rows and omits PatID.':'Counts here describe the imported CSV; see SAS diagnostics for full-run counts.'}</p></div></div><div class="panel-body"><div class="results-controls"><div><label for="result-table">Dataset</label><select id="result-table" data-result-table>${[...resultTables.keys()].map(name=>option(name,name.toUpperCase(),selectedResult)).join('')}</select></div><div><label for="result-search">Find in any column</label><input id="result-search" data-result-search value="${esc(resultState.search)}" placeholder="Type, then press Enter"></div><button class="button" data-action="apply-result-search">Apply search</button><details class="column-picker"><summary>Columns (${cols.size}/${table.columns.length})</summary><div>${table.columns.map(c=>`<label class="check-row"><input type="checkbox" data-result-column="${esc(c)}" ${cols.has(c)?'checked':''}>${esc(c)}</label>`).join('')}</div></details></div><div class="results-stat-strip"><span><strong>${page.total.toLocaleString()}</strong> matching rows</span><span><strong>${table.columns.length}</strong> columns</span><span><strong>${resultState.search?'Filtered':'All'}</strong> imported data</span></div><div class="table-wrap results-table"><table><thead><tr>${table.columns.filter(c=>cols.has(c)).map(c=>`<th><button type="button" data-result-sort="${esc(c)}">${esc(c)} ${resultState.sortColumn===c?(resultState.descending?'↓':'↑'):''}</button></th>`).join('')}</tr></thead><tbody>${page.rows.map(row=>`<tr>${table.columns.map((c,i)=>cols.has(c)?`<td>${esc(row[i]||'')}</td>`:'').join('')}</tr>`).join('')||`<tr><td colspan="${cols.size}">No matching rows</td></tr>`}</tbody></table></div><div class="result-pages"><button class="button small" data-result-page="${page.page-1}" ${page.page===1?'disabled':''}>← Previous</button><span>Page ${page.page} of ${page.pages}</span><button class="button small" data-result-page="${page.page+1}" ${page.page===page.pages?'disabled':''}>Next →</button></div></div></section><section class="panel"><div class="panel-head"><div><h2>Column profile</h2><p>Missing cells in the imported ${esc(selectedResult)} file${resultState.search?' after the current search':''}.</p></div></div>${tableMarkup(['Column','Missing','Share'],profiles.map(p=>[p.column,p.missing.toLocaleString(),`${p.percent.toFixed(1)}%`]))}</section></div>`;
}
function diagnostics(){
  const table=activeResult();
  if(!table)return `<div class="stack">${resultsToolbar()}${resultsEmpty()}</div>`;
  const col=resultState.countColumn&&table.columns.includes(resultState.countColumn)?resultState.countColumn:(table.columns.find(c=>/^(sex|index_source|cov_)/i.test(c))||table.columns[0]);
  const split=resultState.splitColumn&&table.columns.includes(resultState.splitColumn)&&resultState.splitColumn!==col?resultState.splitColumn:'';
  const counts=quickCounts(table,col,split,{search:resultState.search});
  const sasTables=['diagnostics','attrition','counts','missingness','extract_counts','covariate_specs'].filter(name=>resultTables.has(name));
  return `<div class="stack">${resultsToolbar()}<section class="panel"><div class="panel-head"><div><h2>SAS run diagnostics</h2><p>These tables were calculated by SAS over the completed cut.</p></div></div><div class="panel-body">${sasTables.length?`<div class="diagnostic-cards">${sasTables.map(name=>`<button class="diagnostic-card" type="button" data-result-select="${name}"><strong>${name.replaceAll('_',' ').toUpperCase()}</strong><span>${resultTables.get(name).rows.length.toLocaleString()} rows · Open table →</span></button>`).join('')}</div>`:'<p class="hint">Open DIAGNOSTICS, ATTRITION, COUNTS, MISSINGNESS, and EXTRACT_COUNTS CSV files from SAS to show authoritative full-run results here.</p>'}${resultTables.has('diagnostics')?tableMarkup(resultTables.get('diagnostics').columns,resultTables.get('diagnostics').rows.slice(0,5)):''}${resultTables.has('attrition')?`<h3 class="diagnostic-subhead">Cohort attrition</h3>${tableMarkup(resultTables.get('attrition').columns,resultTables.get('attrition').rows.slice(0,30))}`:''}</div></section><section class="panel"><div class="panel-head"><div><h2>Quick counts</h2><p>Explore values in the imported CSV, then download a read-only SAS count for the entire completed dataset.</p></div></div><div class="panel-body"><div class="results-controls"><div><label for="count-table">Imported dataset</label><select id="count-table" data-result-table>${[...resultTables.keys()].map(name=>option(name,name.toUpperCase(),selectedResult)).join('')}</select></div><div><label for="count-column">Count by</label><select id="count-column" data-count-column>${table.columns.map(c=>option(c,c,col)).join('')}</select></div><div><label for="count-split">Optional split</label><select id="count-split" data-count-split><option value="">None</option>${table.columns.filter(c=>c!==col).map(c=>option(c,c,split)).join('')}</select></div><div><label for="count-search">Filter imported rows</label><input id="count-search" data-result-search value="${esc(resultState.search)}" placeholder="Type, then press Enter"></div><button class="button" data-action="apply-result-search">Apply filter</button><button class="button" data-action="export-quick-count">Download full-data SAS count</button></div><p class="hint">Local preview: ${counts.total.toLocaleString()} imported rows, ${counts.distinct.toLocaleString()} distinct ${split?'combinations':'values'}${resultState.search?` after filtering for “${esc(resultState.search)}”`:''}. A loaded COHORT_PREVIEW file contains at most 200 rows; these local counts are exploratory. For COHORT_PREVIEW, the downloaded SAS counts the complete COHORT table. It reads your completed run folder without writing to it.</p>${tableMarkup(split?[col,split,'Rows','Percent']:[col,'Rows','Percent'],counts.rows.map(r=>split?[r.value,r.group,r.count.toLocaleString(),`${r.percent.toFixed(1)}%`]:[r.value,r.count.toLocaleString(),`${r.percent.toFixed(1)}%`]))}${counts.truncated?'<p class="hint">Showing the top 100 values. The SAS count includes all levels.</p>':''}</div></section><section class="panel"><div class="panel-head"><div><h2>Imported-data missingness</h2><p>Fast local check for the selected CSV.</p></div></div>${tableMarkup(['Column','Missing','Percent'],missingness(table,{search:resultState.search}).map(r=>[r.column,r.missing.toLocaleString(),`${r.percent.toFixed(1)}%`]))}</section></div>`;
}
function render() {
  activate();
  document.querySelector('.heading .eyebrow').textContent=populationLabel();
  document.querySelector('.mode-banner span:last-child').textContent=desktop?'Build, run, and review cohorts through your own local SAS session. Source data stays on the institutional server.':'Build and save cohort rules, then export to SAS. Source data stays in your SAS environment.';
  document.querySelector('#execution-mode').textContent=desktop?'Local desktop execution':'Program export mode';
  document.querySelectorAll('[data-view="run"], [data-view="profile"]').forEach(element=>element.hidden=!desktop);
  const badge=document.querySelector('#job-indicator');
  badge.hidden=!desktop;
  if(desktop){badge.textContent=desktopJob?`${desktopJob.status==='running'?'● ':''}${desktopJob.status} · ${desktopJob.kind}`:'No SAS job';badge.dataset.status=desktopJob?.status||'idle';}
  document.querySelector('#current-cohort-label').textContent=definition.name||'New cohort';
  document.querySelector('footer span:last-child').textContent=activeCdm()?'Mini-Sentinel CDM v3.0':'Legacy MarketScan 2023 profile';
  document.querySelector('.tabs [data-view="codebook"]').textContent=activeCdm()?'CDM dictionary':'2023 codebook';
  document.querySelector('#data-profile').value=activeCdm()?'CDM':'RAW';
  document.querySelectorAll('[data-view]').forEach(b=>{ b.classList.toggle(b.classList.contains('side-link')?'selected':'active',b.dataset.view===view); b.setAttribute('aria-current',b.dataset.view===view?'page':'false'); });
  app.innerHTML=view==='graph'?renderTree(definition,catalog,false,validateDefinition(definition).length):view==='builder'?builder():view==='saved'?savedWorkspace():view==='profile'?profileWorkspace():view==='preview'?preview():view==='diagnostics'?diagnostics():view==='run'?runWorkspace():codebook();
  if(view==='saved'&&selectedSavedCohortId&&!cohortDirty&&activeCdm()&&desktop){
    const holder=app.querySelector('.summary-body');
    const button=document.createElement('button');
    button.className='button full-button';button.dataset.action='export-connect';button.textContent='Download local SAS/CONNECT program';
    button.disabled=validateDefinition(definition).length>0||!selectedRunProfileId||!definition.outputPath;
    holder.querySelector('[data-action="export-json"]').before(button);
    const note=document.createElement('p');note.className='hint';note.textContent='For a local SAS/CONNECT runner, first select a profile and fresh output folder on Run in SAS. The engine and protocol downloads above are available now.';
    button.after(note);
  }
  if(view==='graph'||view==='saved'&&selectedSavedCohortId)bindTree(app.querySelector('.tree-workspace'),definition,catalog,{
    changed,refresh:render,notify:toast,domains:DOMAINS,issues:()=>validateDefinition(definition),
    browseCodes:(kind,index)=>{const r=kind==='cov'?definition.covariates[index]:index===-1?definition.index:definition.rules[index];openCodePicker({domain:r.domain,codes:r.codes,label:catalog.domains[r.domain].label,onApply:codes=>{r.codes=codes;changed();render();}}).catch(error=>toast(error.message));},
    addRule:target=>addCriterion(target),
    removeRule:index=>{removeCriterion(definition,index);changed();}
  });
}
function addCriterion(target){
  if(definition.rules.length>=20){toast('A cohort can contain up to 20 additional criteria.');return null;}
  const index=definition.rules.length;
  if(target||definition.logic){definition.logic=structuredClone(treeFor(definition));(groupsIn(definition.logic).find(g=>g.id===target)||definition.logic).children.push(index);}
  definition.rules.push({domain:'DX',sources:DOMAINS.DX.slice(0,2),...(activeCdm()?{encTypes:Object.keys(cdm.ENC_TYPES)}:{}),codes:'',mode:'INCLUDE',from:-90,to:-1,minDays:1});changed();return index;
}
function openEventEditor(index){
  const dialog=document.createElement('dialog');dialog.className='event-editor';dialog.setAttribute('aria-label',index===-1?'Edit index event':`Edit criterion ${index+1}`);
  const r=index===-1?definition.index:definition.rules[index];
  const draw=()=>{dialog.innerHTML=`<div class="picker-head"><div><p class="eyebrow">COHORT TREE</p><h2>${index===-1?'Index event':`Criterion ${index+1}`}</h2></div><button class="button" data-event-done>Done</button></div><div class="panel-body">${ruleEditor(r,index)}</div>`;};
  const close=()=>{dialog.close();dialog.remove();render();};
  dialog.addEventListener('click',e=>{if(e.target.closest('[data-event-done]'))close();});
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('input',e=>{const el=e.target;if(el.dataset.rule!==undefined)r[el.dataset.key]=el.type==='number'?(el.value===''?NaN:Number(el.value)):el.value;if(el.dataset.field)definition[el.dataset.field]=el.value;changed();});
  dialog.addEventListener('change',e=>{const el=e.target;if(el.dataset.encType!==undefined)r.encTypes=el.checked?[...r.encTypes,el.value]:r.encTypes.filter(t=>t!==el.value);if(el.dataset.ruleSource!==undefined)r.sources=el.checked?[...r.sources,el.value]:r.sources.filter(t=>t!==el.value);if(el.dataset.key==='domain'){r.domain=el.value;r.sources=DOMAINS[r.domain].slice(0,2);r.codes='';draw();}changed();});
  draw();document.body.append(dialog);dialog.showModal();
}
function updateExport() {
  document.querySelector('.heading .eyebrow').textContent=populationLabel();
  if(activeCdm()){
    document.querySelectorAll('[data-map-preview]').forEach(el=>el.textContent=mappingPreview(el.dataset.mapPreview));
    for(const key of ['start','end']){const input=document.getElementById(key);if(input){input.min=`${definition.yearStart}-01-01`;input.max=`${definition.yearEnd}-12-31`;}}
  }
  const count=connectionIssues(definition).length;
  const counter=document.querySelector('.details-toggle .hint');
  if(counter)counter.textContent=`· ${count} to configure`;
  if(view!=='saved'||!selectedSavedCohortId||!app.querySelector('.code-preview'))return;
  const errors=validateDefinition(definition);
  document.querySelector('.code-preview').textContent=errors.length?errors.join('\n'):compileSas(definition,engine);
  document.querySelector('.protocol-preview').textContent=selectionProtocol(definition,catalog);
  document.querySelector('[data-action=export-sas]').disabled=errors.length>0;
  const notice=document.querySelector('.mapping-notice');
  notice.textContent=errors.length?errors.join(' '):count?`${count} table mappings remain. The exported SAS program will stop until they are supplied.`:'Table names are configured. Confirm their delivery and year range before running.';
}
function updateSummary() { const holder=document.querySelector('#summary-container'); if(holder) holder.innerHTML=summary(); }
function download(content, filename, type) { const url=URL.createObjectURL(new Blob([content],{type})); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
function filename(extension) { return `${definition.name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,60)||'cohort'}_${activeCdm()?`cdm_${definition.yearStart}_${definition.yearEnd}`:'2023'}.${extension}`; }
async function runDesktopJob(kind){
  if(!desktop)return;
  try{
    if(kind!=='synthetic'){
      if(!selectedRunCohortId||!selectedRunProfileId)throw new Error('Choose a saved cohort and investigator profile before running SAS.');
      if(profileIssues().length)throw new Error(profileIssues().join(' '));
      if(validateDefinition(definition).length)throw new Error(validateDefinition(definition).join(' '));
      const folder=parseRunFolder(definition.outputPath);
      if(folder.user!==desktopSettings.serverUser)throw new Error('Choose a run folder under the selected profile’s server home.');
    }else if(!sasPathCheck?.ok)throw new Error('Validate your local SAS executable in Investigator profiles.');
    if(view!=='run')setView('run');
    desktopJob={status:'running',kind,startedAt:new Date().toISOString(),log:'Starting SAS…'};render();
    desktopJob=await desktop.run({kind,definition,settings:connectSettings,sasExecutable:desktopSettings.sasExecutable,serverUser:desktopSettings.serverUser});
    if(kind!=='synthetic')connectionCheck={ok:true,message:'The SAS/CONNECT host and port were reachable when this job started. SAS sign-on verifies your account.'};
    if(view==='run')render();
  }catch(error){desktopJob=await desktop.job().catch(()=>null);if(kind!=='synthetic')connectionCheck={ok:false,message:error.message};if(view==='run')render();toast(error.message);}
}
function scheduleRunRefresh(){
  clearTimeout(runRefreshTimer);
  runRefreshTimer=setTimeout(()=>{if(['run','profile'].includes(view)&&!app.querySelector('input:focus, select:focus, textarea:focus'))render();},150);
}
async function loadDesktopResults(){
  try{
    const files=await desktop.readResults(connectSettings.resultsFolder,connectSettings.includeCohort);
    for(const file of files)resultTables.set(file.name.replace(/\.csv$/i,'').toLowerCase(),parseCsv(file.text));
    selectedResult=resultTables.has('cohort_preview')?'cohort_preview':files[0].name.replace(/\.csv$/i,'').toLowerCase();
    resultState={search:'',sortColumn:'',descending:false,page:1,visible:null,countColumn:'',splitColumn:''};
    setView('preview');toast(`${files.length} local result files loaded.`);
  }catch(error){toast(error.message);}
}
document.addEventListener('click', e=>{
  const browse=e.target.closest('[data-browse]');
  if(browse){const index=Number(browse.dataset.browse), r=index===-1?definition.index:definition.rules[index];openCodePicker({domain:r.domain,codes:r.codes,label:catalog.domains[r.domain].label,onApply:codes=>{r.codes=codes;document.querySelector(`#${index===-1?'index':`rule-${index}`}-codes`).value=codes;changed();updateSummary();}}).catch(error=>toast(error.message));return;}
  const covBrowse=e.target.closest('[data-cov-browse]');
  if(covBrowse){const r=definition.covariates[Number(covBrowse.dataset.covBrowse)];openCodePicker({domain:r.domain,codes:r.codes,label:cdm.catalog.domains[r.domain].label,onApply:codes=>{r.codes=codes;changed();render();}}).catch(error=>toast(error.message));return;}
  const savedOpen=e.target.closest('[data-saved-open]');if(savedOpen){try{selectSavedCohort(savedOpen.dataset.savedOpen);}catch(error){toast(error.message);}return;}
  const savedDelete=e.target.closest('[data-saved-delete]');if(savedDelete){
    const item=savedCohorts.find(entry=>entry.id===savedDelete.dataset.savedDelete);
    if(item&&!window.confirm(`Delete saved cohort “${item.name}” from this computer?`))return;
    savedCohorts=savedCohorts.filter(entry=>entry.id!==savedDelete.dataset.savedDelete);
    localStorage.setItem(SAVED_COHORTS_KEY,JSON.stringify(savedCohorts));
    if(selectedSavedCohortId===savedDelete.dataset.savedDelete)selectedSavedCohortId='';
    if(selectedRunCohortId===savedDelete.dataset.savedDelete)selectedRunCohortId='';
    render();return;
  }
  const viewButton=e.target.closest('[data-view]'); if(viewButton){setView(viewButton.dataset.view);return;}
  const action=e.target.closest('[data-action]')?.dataset.action;
  if(action==='save-cohort'){saveCohort();return;}
  if(action==='save-tree'){saveCohort({stay:true});return;}
  if(action==='save-tree-as'){saveCohort({stay:true,asNew:true});return;}
  if(action==='new-cohort'){definition=activeCdm()?cdm.freshDefinition():freshDefinition();if(desktop)definition.inputPath=desktopSourcePath;selectedSavedCohortId='';selectedRunCohortId='';changed();setView('builder');return;}
  if(action==='edit-saved'){setView('builder');return;}
  if(desktop&&action==='run-saved'){
    const item=savedCohorts.find(entry=>entry.id===selectedSavedCohortId);
    if(!item){toast('Open a saved cohort first.');return;}
    definition=readDefinition(item.definition);if(activeCdm())definition.inputPath=desktopSourcePath;
    selectedRunCohortId=item.id;selectedRunProfileId='';definition.outputPath='';setView('run');return;
  }
  if(desktop&&action==='choose-sas'){desktop.chooseSas().then(value=>{if(value){desktopSettings.sasExecutable=value;sasPathCheck=null;persistProfiles();void validateSasPath();}}).catch(error=>toast(error.message));return;}
  if(desktop&&action==='validate-sas'){void validateSasPath();return;}
  if(desktop&&action==='choose-results'){desktop.chooseResults().then(value=>{if(value){connectSettings.resultsFolder=value;persistProfiles();render();}}).catch(error=>toast(error.message));return;}
  if(desktop&&action==='check-connection'){void checkDesktopConnection();return;}
  if(desktop&&action==='save-profile'){try{persistProfiles();toast('Connection profile saved on this computer.');render();}catch(error){toast(error.message);}return;}
  if(desktop&&action==='add-profile'){
    try{
      persistProfiles();
      if(profiles.length>=20)throw new Error('Keep at most 20 connection profiles.');
      const profile=createProfile(crypto.randomUUID(),`Profile ${profiles.length+1}`,desktopSettings.sasExecutable);
      profile.host=desktopDefaultHost;
      profiles.push(profile);useProfile(profile);selectedRunProfileId='';definition.outputPath='';persistProfiles();render();
    }catch(error){toast(error.message);}
    return;
  }
  if(desktop&&action==='delete-profile'){
    if(profiles.length<2)return;
    if(!window.confirm(`Delete the ${activeProfile()?.name||'selected'} connection profile from this computer?`))return;
    profiles=profiles.filter(profile=>profile.id!==activeProfileId);
    useProfile(profiles[0]);selectedRunProfileId='';definition.outputPath='';persistProfiles();render();return;
  }
  if(desktop&&action==='new-run-folder'){
    try{freshRunPath();persistProfiles();render();}catch(error){toast(error.message);}return;
  }
  if(desktop&&['run-synthetic','run-cohort','run-results','run-preview'].includes(action)){void runDesktopJob(action.replace('run-',''));return;}
  if(desktop&&action==='load-desktop-results'){void loadDesktopResults();return;}
  if(desktop&&action==='open-job-folder'){desktop.openJobFolder().catch(error=>toast(error.message));return;}
  if(['builder','graph','preview','diagnostics','profile','saved'].includes(action)){setView(action);return;}
  if(action==='add-rule'){const index=addCriterion();render();if(index!==null)document.querySelector(`#rule-${index}-codes`)?.focus();}
  if(action==='add-covariate'){const n=definition.covariates.length+1;definition.covariates.push({key:`feature_${n}`,label:`Feature ${n}`,domain:'DX',sources:['DIA'],codes:'',encTypes:Object.keys(cdm.ENC_TYPES),from:-365,to:-1,minDays:1});changed();render();document.querySelector(`#cov-${n-1}-key`)?.focus();}
  const covRemove=e.target.closest('[data-cov-remove]');if(covRemove){definition.covariates.splice(Number(covRemove.dataset.covRemove),1);changed();render();}
  if(action==='open-results'){document.querySelector('#result-files').click();return;}
  if(action==='export-results'){try{download(cdm.compileResultsExport(definition,connectSettings),filename('results_export.sas'),'text/plain');toast('Local SAS results exporter downloaded.');}catch(error){toast(error.message);}return;}
  if(action==='export-print-preview'){try{download(cdm.compilePrintPreview(definition,connectSettings),filename('print_preview.sas'),'text/plain');toast('100-row SAS PROC PRINT script downloaded.');}catch(error){toast(error.message);}return;}
  const resultRemove=e.target.closest('[data-result-remove]');if(resultRemove){resultTables.delete(resultRemove.dataset.resultRemove);if(selectedResult===resultRemove.dataset.resultRemove)selectedResult=resultTables.keys().next().value||'';resultState={search:'',sortColumn:'',descending:false,page:1,visible:null,countColumn:'',splitColumn:''};render();return;}
  const resultSelect=e.target.closest('[data-result-select]');if(resultSelect){selectedResult=resultSelect.dataset.resultSelect;resultState={search:'',sortColumn:'',descending:false,page:1,visible:null,countColumn:'',splitColumn:''};setView('preview');return;}
  const sort=e.target.closest('[data-result-sort]');if(sort){const key=sort.dataset.resultSort;resultState.descending=resultState.sortColumn===key?!resultState.descending:false;resultState.sortColumn=key;resultState.page=1;render();return;}
  const page=e.target.closest('[data-result-page]');if(page){resultState.page=Number(page.dataset.resultPage);render();return;}
  if(action==='apply-result-search'){resultState.search=app.querySelector('[data-result-search]')?.value.trim()||'';resultState.page=1;render();return;}
  if(action==='export-quick-count'){
    try{const table=activeResult();if(!table)throw new Error('Open a SAS CSV file first.');const column=resultState.countColumn&&table.columns.includes(resultState.countColumn)?resultState.countColumn:(table.columns.find(c=>/^(sex|index_source|cov_)/i.test(c))||table.columns[0]);const sas=compileQuickCount({dataset:selectedResult,column,split:resultState.splitColumn,outputPath:definition.outputPath,host:connectSettings.host,port:connectSettings.port,script:connectSettings.script});download(sas,`${selectedResult}_${column}_counts.sas`,'text/plain');toast('Read-only SAS quick count downloaded.');}catch(error){toast(error.message);}return;
  }
  const remove=e.target.closest('[data-remove]'); if(remove){removeCriterion(definition,Number(remove.dataset.remove));changed();render();}
  if(action==='export-json'){download(JSON.stringify(definition,null,2),filename('json'),'application/json');toast('Definition downloaded.');}
  if(action==='export-protocol'){download(selectionProtocol(definition,catalog),filename('protocol.txt'),'text/plain');toast('Study population protocol downloaded.');}
  if(action==='export-sas'){try{download(compileSas(definition,engine),filename('sas'),'text/plain');toast('SAS program downloaded.');}catch(error){toast(error.message);}}
  if(action==='export-connect'){try{download(cdm.compileConnect(definition,engine,parseCodes,connectSettings),filename('connect.sas'),'text/plain');toast('Local SAS/CONNECT program downloaded.');}catch(error){toast(error.message);}}
});
app.addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.desktop){
    const key=el.dataset.desktop,previous=desktopSettings.serverUser;
    desktopSettings[key]=el.value;
    if(key==='sasExecutable')sasPathCheck=null;
    if(key==='serverUser'&&(!desktopSettings.outputParent||desktopSettings.outputParent===`/storage/storage1/PHShome/${previous}`)){
      desktopSettings.outputParent=el.value?`/storage/storage1/PHShome/${el.value}`:'';
      const parent=app.querySelector('[data-desktop="outputParent"]');if(parent)parent.value=desktopSettings.outputParent;
    }
    if(key==='serverUser'||key==='outputParent')connectionCheck=null;
    return;
  }
  if(el.dataset.cov!==undefined&&el.dataset.key){const r=definition.covariates[Number(el.dataset.cov)];r[el.dataset.key]=el.type==='number'?(el.value===''?NaN:Number(el.value)):el.value;changed();updateSummary();return;}
  if(el.dataset.connect){
    connectSettings[el.dataset.connect]=el.type==='checkbox'?el.checked:el.value;
    if(['host','port','script'].includes(el.dataset.connect))connectionCheck=null;
    if(!desktop)try{localStorage.setItem(CONNECT_KEY,JSON.stringify(connectSettings));}catch(error){toast(`Connection settings could not be saved. ${error.message}`);}
    return;
  }
  if(el.dataset.field){definition[el.dataset.field]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?NaN:Number(el.value)):el.value;if(el.dataset.field!=='outputPath')changed();updateSummary();}
  if(el.dataset.map){definition.mapping[el.dataset.map]=el.value.trim();changed();} if(el.dataset.map||el.dataset.field)updateExport();
  if(el.dataset.rule!==undefined){const r=Number(el.dataset.rule)===-1?definition.index:definition.rules[Number(el.dataset.rule)];r[el.dataset.key]=el.type==='number'?(el.value===''?NaN:Number(el.value)):el.value;changed();updateSummary();}
});
app.addEventListener('change',e=>{
  const el=e.target;
  if(desktop&&el.dataset.runProfileSelect!==undefined){
    const selected=profiles.find(profile=>profile.id===el.value);
    selectedRunProfileId=selected?.id||'';
    if(selected){useProfile(selected);try{freshRunPath();}catch{definition.outputPath='';}void validateSasPath();}
    else definition.outputPath='';
    render();return;
  }
  if(desktop&&el.dataset.runCohortSelect!==undefined){
    if(el.value){try{selectSavedCohort(el.value);selectedRunCohortId=el.value;if(selectedRunProfileId)try{freshRunPath();}catch{definition.outputPath='';}}catch(error){toast(error.message);}}
    else{selectedRunCohortId='';definition.outputPath='';}
    render();return;
  }
  if(desktop&&el.dataset.profileSelect!==undefined){
    try{
      persistProfiles();
      const selected=profiles.find(profile=>profile.id===el.value);
      if(!selected)throw new Error('Choose an existing connection profile.');
      useProfile(selected);
      selectedRunProfileId='';definition.outputPath='';void validateSasPath();
      persistProfiles();render();
    }catch(error){toast(error.message);render();}
    return;
  }
  if(desktop&&el.dataset.profileName!==undefined){
    try{const current=activeProfile();const oldName=current.name;current.name=el.value.trim();try{persistProfiles();}catch(error){current.name=oldName;throw error;}render();}catch(error){toast(error.message);render();}
    return;
  }
  if(desktop&&(el.dataset.desktop||el.dataset.connect||el.dataset.field==='outputPath')){
    try{persistProfiles();}catch(error){toast(error.message);}
    if(el.dataset.desktop==='sasExecutable')void validateSasPath();
    scheduleRunRefresh();
    return;
  }
  if(el.dataset.resultTable!==undefined){selectedResult=el.value;resultState={search:'',sortColumn:'',descending:false,page:1,visible:null,countColumn:'',splitColumn:''};render();return;}
  if(el.dataset.resultColumn!==undefined){if(!resultState.visible)resultState.visible=new Set(activeResult().columns);el.checked?resultState.visible.add(el.dataset.resultColumn):resultState.visible.delete(el.dataset.resultColumn);if(!resultState.visible.size){resultState.visible.add(el.dataset.resultColumn);toast('Keep at least one column visible.');}render();return;}
  if(el.dataset.countColumn!==undefined){resultState.countColumn=el.value;if(resultState.splitColumn===el.value)resultState.splitColumn='';render();return;}
  if(el.dataset.countSplit!==undefined){resultState.splitColumn=el.value;render();return;}
  if(el.dataset.resultSearch!==undefined){resultState.search=el.value.trim();resultState.page=1;render();return;}
  if(el.dataset.covEnc!==undefined){const r=definition.covariates[Number(el.dataset.covEnc)];r.encTypes=el.checked?[...r.encTypes,el.value]:r.encTypes.filter(value=>value!==el.value);changed();updateSummary();return;}
  if(el.dataset.cov!==undefined&&el.dataset.key==='domain'){const r=definition.covariates[Number(el.dataset.cov)];r.sources=cdm.DOMAINS[r.domain].slice();r.codes='';r.encTypes=r.domain==='NDC'?[]:Object.keys(cdm.ENC_TYPES);changed();render();return;}
  if(el.dataset.encType!==undefined){const r=Number(el.dataset.encType)===-1?definition.index:definition.rules[Number(el.dataset.encType)];r.encTypes=el.checked?[...r.encTypes,el.value]:r.encTypes.filter(t=>t!==el.value);changed();render();}
  if(el.dataset.ruleSource!==undefined){const r=Number(el.dataset.ruleSource)===-1?definition.index:definition.rules[Number(el.dataset.ruleSource)];r.sources=el.checked?[...r.sources,el.value]:r.sources.filter(t=>t!==el.value);changed();render();}
  if(el.dataset.output){definition.outputs=el.checked?[...definition.outputs,el.dataset.output]:definition.outputs.filter(t=>t!==el.dataset.output);changed();render();}
  if(el.dataset.key==='mode')render();
  if(el.dataset.key==='domain'){const r=Number(el.dataset.rule)===-1?definition.index:definition.rules[Number(el.dataset.rule)];r.sources=DOMAINS[r.domain].slice(0,2);r.codes='';changed();render();}
  if(['enrollment','rx','family','edition','indexOrder','yearStart','yearEnd'].includes(el.dataset.field)){if(!definition.enrollment)definition.rx=false;if(['family','edition'].includes(el.dataset.field))definition.mapping=Object.fromEntries(TABLES.map(t=>[t,'']));render();}
});
document.querySelector('#review-button').onclick=()=>saveCohort();
document.querySelector('#data-profile').onchange=e=>{
  try{
    localStorage.setItem(activeCdm()?DRAFT_KEY:LEGACY_DRAFT_KEY,JSON.stringify(definition));
    const c=e.target.value==='CDM',stored=localStorage.getItem(c?DRAFT_KEY:LEGACY_DRAFT_KEY);
    definition=stored?readDefinition(JSON.parse(stored)):(c?cdm.freshDefinition():freshDefinition());
    selectedSavedCohortId='';selectedRunCohortId='';
    document.querySelector('#save-state').textContent='Local draft';setView('graph');
  }catch(error){e.target.value=activeCdm()?'CDM':'RAW';toast(`Could not switch profiles. ${error.message}`);}
};
document.querySelector('#save-button').onclick=()=>saveCohort();
document.querySelector('#import-button').onclick=()=>document.querySelector('#import-file').click();
document.querySelector('#result-files').onchange=async e=>{
  const files=[...e.target.files];if(!files.length)return;
  try{
    const parsed=[];
    for(const file of files){
      if(!/\.csv$/i.test(file.name)||file.size>50_000_000)throw new Error(`${file.name}: use a CSV file of at most 50 MB.`);
      const name=file.name.replace(/\.csv$/i,'').toLowerCase();
      if(!/^[a-z_][a-z0-9_]{0,31}$/.test(name))throw new Error(`${file.name}: the filename must match a SAS dataset name.`);
      parsed.push([name,parseCsv(await file.text())]);
    }
    for(const [name,table] of parsed)resultTables.set(name,table);
    selectedResult=resultTables.has('cohort_preview')?'cohort_preview':resultTables.has('cohort')?'cohort':files.at(-1).name.replace(/\.csv$/i,'').toLowerCase();
    resultState={search:'',sortColumn:'',descending:false,page:1,visible:null,countColumn:'',splitColumn:''};setView('preview');toast(`${files.length} SAS CSV file${files.length===1?'':'s'} opened locally.`);
  }catch(error){toast(`Could not open results. ${error.message}`);}finally{e.target.value='';}
};
document.querySelector('#import-file').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>500000)throw new Error('The definition file exceeds 500 KB.');
    definition=readDefinition(JSON.parse(await file.text()));selectedSavedCohortId='';selectedRunCohortId='';if(desktop&&activeCdm())definition.inputPath=desktopSourcePath;changed();setView('graph');toast('Definition opened.');
  }catch(error){toast(`Could not open definition. ${error.message}`);}finally{e.target.value='';}
};
try {
  try{const saved=JSON.parse(localStorage.getItem(CONNECT_KEY));if(saved&&typeof saved==='object')connectSettings={...connectSettings,...saved};}catch(error){toast(`Connection settings could not be loaded. ${error.message}`);}
  const responses=await Promise.all([fetch('./catalog.json?v=d6e53643d0f2'),fetch('./cohort_engine.sas?v=d6e53643d0f2'),fetch('./cdm_engine.sas?v=d6e53643d0f2')]);
  if(responses.some(r=>!r.ok))throw new Error('Unable to load the schema or SAS engine.');
  rawCatalog=await responses[0].json();rawEngine=await responses[1].text();cdmEngine=await responses[2].text();activate();
  let stored;
  try{stored=localStorage.getItem(DRAFT_KEY);}catch(error){toast(`Local draft storage is unavailable. ${error.message}`);}
  if(stored){try{definition=readDefinition(JSON.parse(stored));document.querySelector('#save-state').textContent='Saved on this device';}catch(error){definition=cdm.freshDefinition();toast(`The saved draft could not be loaded. ${error.message}`);}}
  try{const raw=localStorage.getItem(SAVED_COHORTS_KEY);if(raw)savedCohorts=readSavedCohorts(JSON.parse(raw));}catch(error){toast(`Saved cohort library could not be loaded. ${error.message}`);}
  if(desktop){
    try{const saved=JSON.parse(localStorage.getItem(DESKTOP_KEY));if(saved&&typeof saved==='object')desktopSettings={...desktopSettings,...saved};}catch(error){toast(`Desktop settings could not be loaded. ${error.message}`);}
    const environment=await desktop.environment();
    desktopDefaultHost=environment.defaultHost||'';
    desktopSourcePath=environment.sourcePath;
    desktopJob=environment.job;
    if(!desktopSettings.sasExecutable)desktopSettings.sasExecutable=environment.defaultSas;
    if(!desktopSettings.serverUser&&definition.outputPath)desktopSettings.serverUser=definition.outputPath.split('/')[4]||'';
    if(!desktopSettings.outputParent&&desktopSettings.serverUser)desktopSettings.outputParent=`/storage/storage1/PHShome/${desktopSettings.serverUser}`;
    let storedProfiles=null;
    try{const raw=localStorage.getItem(PROFILE_KEY);if(raw)storedProfiles=readProfileStore(JSON.parse(raw));}catch(error){toast(`Connection profiles could not be loaded. ${error.message}`);}
    if(storedProfiles){profiles=storedProfiles.profiles;activeProfileId=storedProfiles.activeId;useProfile(activeProfile());}
    else{
      if(!connectSettings.host)connectSettings.host=desktopDefaultHost;
      const first=createProfile(crypto.randomUUID(),'Personal',desktopSettings.sasExecutable);
      profiles=[profileFromSettings(first,desktopSettings,connectSettings)];activeProfileId=first.id;
      useProfile(profiles[0]);persistProfiles();view='profile';
    }
    if(activeCdm()&&!definition.inputPath)definition.inputPath=desktopSourcePath;
    if(desktopSettings.sasExecutable)void validateSasPath();
    desktop.onJobUpdate(state=>{
      const previous=desktopJob?.status;desktopJob=state;
      if(view==='run'&&previous===state.status&&app.querySelector('.job-log')){
        const log=app.querySelector('.job-log'),follow=log.scrollTop+log.clientHeight>=log.scrollHeight-30;
        log.textContent=state.log||'Waiting for SAS output. If SAS opens a sign-on prompt, enter your credentials there.';
        if(follow)log.scrollTop=log.scrollHeight;
        const label=app.querySelector('#job-state');if(label)label.textContent=`${state.status} · ${state.kind} · ${state.startedAt||''}`;
        const badge=document.querySelector('#job-indicator');badge.textContent=`${state.status==='running'?'● ':''}${state.status} · ${state.kind}`;badge.dataset.status=state.status;
      }else if(view==='run')render();
      else{const badge=document.querySelector('#job-indicator');badge.textContent=`${state.status==='running'?'● ':''}${state.status} · ${state.kind}`;badge.dataset.status=state.status;}
    });
  }
  render();
} catch(error) { app.innerHTML=`<div class="error-screen"><h2>The workspace could not load.</h2><p>${esc(error.message)}</p><p>Reload this page to retry. For a local copy, start the server with <code>npm start</code>.</p></div>`; }
