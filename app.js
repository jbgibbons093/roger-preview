import * as cdm from './cdm.js';
import { freshDefinition, readDefinition, validateDefinition, connectionIssues, requiredTables, compileSas, parseCodes, TABLES as RAW_TABLES, DOMAINS as RAW_DOMAINS } from './cohort.js';
import { openCodePicker } from './code-picker.js';
import { treeFor, groupsIn, logicText, usesOr, removeCriterion } from './logic.js';
import { renderTree, bindTree } from './cohort-tree.js';
import { selectionProtocol } from './protocol.js';

const DRAFT_KEY = 'roger.cohort.cdm.v1', LEGACY_DRAFT_KEY = 'roger.cohort.v1', CONNECT_KEY='roger.sasconnect.v1';
let definition = cdm.freshDefinition();
let connectSettings={host:'',port:12600,script:'C:\\Program Files\\SASHome\\SASFoundation\\9.4\\connect\\saslink\\tcpunix.scr'};
let TABLES=cdm.TABLES, DOMAINS=cdm.DOMAINS;
let rawCatalog, rawEngine, cdmEngine;
const activeCdm=()=>cdm.isCdm(definition);
const populationLabel=()=>activeCdm()?`Mini-Sentinel CDM · ${definition.yearStart}–${definition.yearEnd}`:`MarketScan ${catalog.families[definition.family]} · 2023 · Set ${definition.edition}`;
const ageLabel=()=>activeCdm()?'Age at index':'Reported age';
function activate(){ TABLES=activeCdm()?cdm.TABLES:RAW_TABLES; DOMAINS=activeCdm()?cdm.DOMAINS:RAW_DOMAINS; catalog=activeCdm()?cdm.catalog:rawCatalog; engine=activeCdm()?cdmEngine:rawEngine; }
let view = 'graph';
let catalog, engine, toastTimer;
const app = document.querySelector('#app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const option = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
const field = (label, key, value, type = 'text', extra = '') => `<div><label for="${key}">${label}</label><input id="${key}" data-field="${key}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const number = (label, key, value, min = 0, max = activeCdm()?3650:365) => field(label, key, value, 'number', `min="${min}" max="${max}" step="1"`);
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 4500); }
function changed() { document.querySelector('#save-state').textContent = 'Unsaved changes'; }
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
function summary() {
  const errors = validateDefinition(definition);
  let count = 0;
  try { count = parseCodes(definition.index.codes, definition.index.domain).length; } catch { count = null; }
  return `<aside class="summary panel"><div class="summary-head"><p class="eyebrow">YOUR COHORT</p><div class="summary-title">${esc(definition.name || 'Untitled cohort')}</div><p class="hint">${esc(populationLabel())}</p></div><div class="summary-body">
    <div class="rule-count">${definition.rules.length + 1}<small>event criteria in this definition</small></div><hr>
    <dl><dt>Index code list</dt><dd>${count === null ? 'Check codes' : `${count} ${count === 1 ? 'code' : 'codes'}`}</dd><dt>${ageLabel()}</dt><dd>${definition.ageMin}–${definition.ageMax}</dd><dt>Enrollment</dt><dd>${definition.enrollment ? 'Required' : 'Optional'}</dd><dt>Claim extracts</dt><dd>${definition.outputs.length} tables</dd></dl>
    <hr><h3>Enrollment window</h3>${!definition.enrollment ? '<p class="hint">Enrollment is not required.</p>' : `<div class="timeline" role="img" aria-label="${definition.baseline} days before index and ${definition.followup} days after index"><div class="base"></div><div class="index"><span>INDEX</span></div><div class="follow"></div><div class="ends"><span>−${definition.baseline} days</span><span>+${definition.followup} days</span></div></div>`}
    <div class="notice ${errors.length ? '' : 'info'}">${errors.length ? `<strong>Definition needs attention</strong><ul>${errors.slice(0, 3).map(e => `<li>${esc(e)}</li>`).join('')}</ul>${errors.length > 3 ? '<p>Review the definition for additional issues.</p>' : ''}` : '<strong>Definition ready to review</strong><br>Export the program to run in SAS.'}</div>
    <hr><div class="status-row"><span class="status-dot"></span>Run the generated program in local SAS</div><p class="hint">SAS/CONNECT submits the cut to the institutional server. Cohort size and attrition appear in the SAS results.</p><button class="button primary full-button" data-action="review">Review &amp; export <span aria-hidden="true">→</span></button>
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
  return panel('08','Local SAS/CONNECT','The generated runner starts in local SAS and submits the CDM work to the server.',`<div class="fields"><div><label for="connect-host">Server hostname</label><input id="connect-host" data-connect="host" value="${esc(connectSettings.host)}" autocomplete="off" placeholder="Enter your reachable SAS server"></div><div><label for="connect-port">Port</label><input id="connect-port" data-connect="port" type="number" min="1" max="65535" value="${esc(connectSettings.port)}"></div><div class="full"><label for="connect-script">Local SAS link script</label><input id="connect-script" data-connect="script" value="${esc(connectSettings.script)}" spellcheck="false"></div></div><p class="hint">Connection settings stay on this device and are omitted from cohort JSON. The SAS sign-on script requests your credentials locally. For persistent results, enter a new one-level output directory under /storage/storage1/PHShome/jg093 in the mappings panel. The runner creates that directory.</p>`);
}
function builder() {
  return `<div class="builder-grid"><div class="stack">
    ${panel('01', 'Population', 'Choose the source population and index date range.', populationFields())}
    ${panel('02', 'Index event', 'The selected matching event establishes each person’s index date.', ruleEditor(definition.index,-1) + '<p class="hint" style="margin-top:15px">Demographics and subsequent rules apply after the index event is selected. Other candidate events do not replace an ineligible selected event.</p>')}
    ${panel('03', 'Eligibility criteria', 'Criteria follow the AND/OR grouping in the cohort tree.', `<div class="logic-summary"><strong>${esc(logicText(treeFor(definition)))}</strong><button class="button small" data-action="graph">Edit condition tree</button></div>${definition.rules.length ? definition.rules.map((r,i)=>`<div class="rule"><div class="rule-head"><span class="rule-label"><span class="logic ${r.mode==='EXCLUDE'?'exclude':''}">${r.mode === 'INCLUDE' ? 'INCLUDE' : 'EXCLUDE'}</span> &nbsp; Criterion ${i+1}</span><button aria-label="Remove criterion ${i+1}" data-remove="${i}">×</button></div><div class="rule-body">${ruleEditor(r,i)}</div></div>`).join(`<div class="and-line">${usesOr(treeFor(definition))?'TREE CRITERION':'AND'}</div>`) : '<div class="empty">Add diagnoses, procedures, or medications to refine the population.<br>Each criterion can have its own window relative to index.</div>'}<button class="add-rule" data-action="add-rule" ${definition.rules.length>=20?'disabled':''}>+ Add eligibility criterion</button>`)}
    ${panel('04', 'Enrollment & observation', 'Set how much observable time each person needs around index.', `<label class="check-row" style="margin-bottom:20px"><input type="checkbox" data-field="enrollment" ${definition.enrollment?'checked':''}>Require ${activeCdm()?'medical coverage (MedCov=Y)':'continuous enrollment'} across the observation window</label><div class="fields three">${number('Days before index','baseline',definition.baseline)}${number('Days after index','followup',definition.followup)}${number('Maximum internal gap','gap',definition.gap)}</div><p class="hint">The window includes index day. Coverage must reach both endpoints. Each internal gap may be at most the selected number of days.</p><label class="check-row" style="margin-top:18px"><input type="checkbox" data-field="rx" ${definition.rx?'checked':''} ${!definition.enrollment?'disabled':''}>Require ${activeCdm()?'drug coverage (DrugCov=Y)':'pharmacy capture'} throughout the covered intervals</label>`)}
    ${panel('05', 'Data cut', 'Keep one cohort row per person and select the related records to extract.', `<div class="fields">${TABLES.map(t=>`<label class="output-item ${definition.outputs.includes(t)?'selected':''}"><input type="checkbox" data-output="${t}" ${definition.outputs.includes(t)?'checked':''}><span class="table-code">${t}</span><span>${catalog.tables[t].label}<small>${activeCdm()?catalog.tables[t].extract:t==='T'?'Intervals overlapping the cut window':t==='I'?'Selected by admission date':'Selected by service date'}</small></span></label>`).join('')}</div><div class="fields" style="margin-top:21px">${number('Extract days before index','extractBefore',definition.extractBefore)}${number('Extract days after index','extractAfter',definition.extractAfter)}</div><p class="hint">At final delivery, the cohort, attrition table, and definition are included. Claim extracts preserve the original fields and add the index date. Enrollment records preserve their original endpoints. ${activeCdm()?'Annual extracts remain in separate files. Demographic and Death extracts include all records for selected people. Death dates do not change enrollment.':''}</p>`)}
    ${mappingPanel()}
    ${workflowPanel()}
    ${connectionPanel()}
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
    <section class="panel"><div class="panel-head"><div><h2>Cohort attrition</h2><p>Counts will be produced by SAS after execution.</p></div></div><table><thead><tr><th>Selection step</th><th>People remaining</th></tr></thead><tbody><tr><td>${definition.indexOrder==='LAST'?'Last':'First'} matching index event</td><td>Awaiting SAS run</td></tr><tr><td>Demographic requirements</td><td>Awaiting SAS run</td></tr>${definition.enrollment?'<tr><td>Enrollment requirements</td><td>Awaiting SAS run</td></tr>':''}${usesOr(treeFor(definition))?'<tr><td>Combined AND/OR condition tree</td><td>Awaiting SAS run</td></tr>':definition.rules.map((r,i)=>`<tr><td>Criterion ${i+1} · ${r.mode==='INCLUDE'?'Inclusion':'Exclusion'}</td><td>Awaiting SAS run</td></tr>`).join('')}</tbody></table></section>
  </div><aside class="summary panel"><div class="summary-head"><p class="eyebrow">EXPORT PACKAGE</p><h2>Ready for your SAS workspace.</h2></div><div class="summary-body"><p class="review-summary-text" style="font-size:14px">A self-contained SAS 9.4 program with the cohort rules, code lists, selection steps, and requested extracts.</p>${mappingIssues.length?`<div class="notice mapping-notice"><strong>${mappingIssues.length} table mappings remain</strong><br>${activeCdm()?'Fill in the mappings in the builder and regenerate the program.':'You can download now and fill in the mappings in the program.'} SAS stops until mappings are supplied.</div>`:'<div class="notice info mapping-notice">Table names are configured. Confirm their delivery and year range before running.</div>'}<button class="button primary full-button" data-action="export-sas" ${errors.length?'disabled':''}>Download SAS program ↓</button><button class="button full-button" data-action="export-json">Download definition</button><button class="button full-button" data-action="export-protocol">Download selection protocol</button><button class="button subtle full-button" data-action="builder">Back to definition</button><hr><p class="export-meta">The SAS 9.4 synthetic check and institutional schema preflight passed. Review each definition-specific run and its diagnostics.</p><p class="hint">For a first check, ${activeCdm()?'<a href="./synthetic_cdm_fixture.sas" download>download the CDM SAS check</a>':'<a href="./synthetic_fixture.sas" download>download the synthetic SAS check</a> and the <a href="./synthetic_tree_fixture.sas" download>nested tree check</a>'}. Run each in a separate fresh SAS session before using research data.</p></div></aside></div>`;
}
function codebook() {
  if(activeCdm())return cdmCodebook();
  return `<div class="stack">${panel('2023','Commercial & Medicare data dictionary','Version 1.0 · Verified against the vendor’s 2023 dictionary and user guide.',`<p class="review-summary-text">This release uses a single, explicit schema for 2023. Additional codebooks can be added as separate year profiles without changing saved definitions.</p><div class="toolbar"><a class="button" href="${catalog.dictionaryUrl}" target="_blank" rel="noreferrer">Open data dictionary ↗</a><a class="button" href="${catalog.guideUrl}" target="_blank" rel="noreferrer">Open user guide ↗</a></div>`)}<section class="panel"><div class="panel-head"><div><h2>Tables behind the cohort builder</h2><p>Table letters are source definitions. Your SAS dataset names are configured separately.</p></div></div><div class="table-wrap"><table><thead><tr><th>Table</th><th>Records</th><th>Date used</th><th>Diagnosis fields searched</th><th>Dictionary</th></tr></thead><tbody>${TABLES.map(t=>`<tr><td><code>${t}</code></td><td>${catalog.tables[t].label}</td><td><code>${catalog.tables[t].date}${t==='T'?' / DTEND':''}</code></td><td><code>${catalog.tables[t].diagnoses?.join(', ')||'Not used for diagnoses'}</code></td><td><a href="${catalog.dictionaryUrl}#page=${catalog.tables[t].page}" target="_blank" rel="noreferrer">Page ${catalog.tables[t].page}</a></td></tr>`).join('')}</tbody></table></div></section>${panel('i','Interpretation notes','Source-specific details that affect cohort definitions.',catalog.notes.map(n=>`<div class="catalog-note"><h3>${n.title}</h3><p>${n.text}</p><a href="${n.source==='dictionary'?catalog.dictionaryUrl:catalog.guideUrl}#page=${n.page}" target="_blank" rel="noreferrer">${n.source==='dictionary'?'Dictionary':'User guide'} · PDF page ${n.page} ↗</a></div>`).join(''))}</div>`;
}
function render() {
  activate();
  document.querySelector('.heading .eyebrow').textContent=populationLabel();
  document.querySelector('.mode-banner span:last-child').textContent='Build and save cohort rules, then export to SAS. Source data stays in your SAS environment.';
  document.querySelector('footer span:last-child').textContent=activeCdm()?'Mini-Sentinel CDM v3.0':'Legacy MarketScan 2023 profile';
  document.querySelector('.tabs [data-view="codebook"]').textContent=activeCdm()?'CDM dictionary':'2023 codebook';
  document.querySelector('#data-profile').value=activeCdm()?'CDM':'RAW';
  document.querySelectorAll('[data-view]').forEach(b=>{ b.classList.toggle(b.classList.contains('side-link')?'selected':'active',b.dataset.view===view); b.setAttribute('aria-current',b.dataset.view===view?'page':'false'); });
  app.innerHTML=view==='graph'?renderTree(definition,catalog):view==='builder'?builder():view==='review'?review():codebook();
  if(view==='review'&&activeCdm()){
    const holder=app.querySelector('.summary-body');
    const button=document.createElement('button');
    button.className='button full-button';button.dataset.action='export-connect';button.textContent='Download local SAS/CONNECT program';
    button.disabled=validateDefinition(definition).length>0;
    holder.querySelector('[data-action="export-json"]').before(button);
    const note=document.createElement('p');note.className='hint';note.textContent='Run this program in local SAS. It signs on, submits the stages remotely, and signs off. Set the server details in Cohort definition.';
    button.after(note);
  }
  if(view==='graph')bindTree(app.querySelector('.tree-workspace'),definition,catalog,{
    changed,refresh:render,notify:toast,editEvent:openEventEditor,
    editStage:key=>{setView('builder');const target=document.querySelector(key==='population'?'#name':key==='demographics'?'#ageMin':key==='enrollment'?'#baseline':'#extractBefore');target?.scrollIntoView({block:'center'});target?.focus();},
    addRule:target=>{const index=addCriterion(target);if(index!==null){render();openEventEditor(index);}},
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
  if(view!=='review')return;
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
document.addEventListener('click', e=>{
  const browse=e.target.closest('[data-browse]');
  if(browse){const index=Number(browse.dataset.browse), r=index===-1?definition.index:definition.rules[index];openCodePicker({domain:r.domain,codes:r.codes,label:catalog.domains[r.domain].label,onApply:codes=>{r.codes=codes;document.querySelector(`#${index===-1?'index':`rule-${index}`}-codes`).value=codes;changed();updateSummary();}}).catch(error=>toast(error.message));return;}
  const viewButton=e.target.closest('[data-view]'); if(viewButton){setView(viewButton.dataset.view);return;}
  const action=e.target.closest('[data-action]')?.dataset.action;
  if(action==='review'||action==='builder'||action==='graph'){setView(action);return;}
  if(action==='add-rule'){const index=addCriterion();render();if(index!==null)document.querySelector(`#rule-${index}-codes`)?.focus();}
  const remove=e.target.closest('[data-remove]'); if(remove){removeCriterion(definition,Number(remove.dataset.remove));changed();render();}
  if(action==='export-json'){download(JSON.stringify(definition,null,2),filename('json'),'application/json');toast('Definition downloaded.');}
  if(action==='export-protocol'){download(selectionProtocol(definition,catalog),filename('protocol.txt'),'text/plain');toast('Study population protocol downloaded.');}
  if(action==='export-sas'){try{download(compileSas(definition,engine),filename('sas'),'text/plain');toast('SAS program downloaded.');}catch(error){toast(error.message);}}
  if(action==='export-connect'){try{download(cdm.compileConnect(definition,engine,parseCodes,connectSettings),filename('connect.sas'),'text/plain');toast('Local SAS/CONNECT program downloaded.');}catch(error){toast(error.message);}}
});
app.addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.connect){connectSettings[el.dataset.connect]=el.value;try{localStorage.setItem(CONNECT_KEY,JSON.stringify(connectSettings));}catch(error){toast(`Connection settings could not be saved. ${error.message}`);}return;}
  if(el.dataset.field){definition[el.dataset.field]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?NaN:Number(el.value)):el.value;changed();updateSummary();}
  if(el.dataset.map){definition.mapping[el.dataset.map]=el.value.trim();changed();} if(el.dataset.map||el.dataset.field)updateExport();
  if(el.dataset.rule!==undefined){const r=Number(el.dataset.rule)===-1?definition.index:definition.rules[Number(el.dataset.rule)];r[el.dataset.key]=el.type==='number'?(el.value===''?NaN:Number(el.value)):el.value;changed();updateSummary();}
});
app.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.encType!==undefined){const r=Number(el.dataset.encType)===-1?definition.index:definition.rules[Number(el.dataset.encType)];r.encTypes=el.checked?[...r.encTypes,el.value]:r.encTypes.filter(t=>t!==el.value);changed();render();}
  if(el.dataset.ruleSource!==undefined){const r=Number(el.dataset.ruleSource)===-1?definition.index:definition.rules[Number(el.dataset.ruleSource)];r.sources=el.checked?[...r.sources,el.value]:r.sources.filter(t=>t!==el.value);changed();render();}
  if(el.dataset.output){definition.outputs=el.checked?[...definition.outputs,el.dataset.output]:definition.outputs.filter(t=>t!==el.dataset.output);changed();render();}
  if(el.dataset.key==='mode')render();
  if(el.dataset.key==='domain'){const r=Number(el.dataset.rule)===-1?definition.index:definition.rules[Number(el.dataset.rule)];r.sources=DOMAINS[r.domain].slice(0,2);r.codes='';changed();render();}
  if(['enrollment','rx','family','edition','indexOrder','yearStart','yearEnd'].includes(el.dataset.field)){if(!definition.enrollment)definition.rx=false;if(['family','edition'].includes(el.dataset.field))definition.mapping=Object.fromEntries(TABLES.map(t=>[t,'']));render();}
});
document.querySelector('#review-button').onclick=()=>setView('review');
document.querySelector('#data-profile').onchange=e=>{
  try{
    localStorage.setItem(activeCdm()?DRAFT_KEY:LEGACY_DRAFT_KEY,JSON.stringify(definition));
    const c=e.target.value==='CDM',stored=localStorage.getItem(c?DRAFT_KEY:LEGACY_DRAFT_KEY);
    definition=stored?readDefinition(JSON.parse(stored)):(c?cdm.freshDefinition():freshDefinition());
    document.querySelector('#save-state').textContent='Local draft';setView('graph');
  }catch(error){e.target.value=activeCdm()?'CDM':'RAW';toast(`Could not switch profiles. ${error.message}`);}
};
document.querySelector('#save-button').onclick=()=>{
  try{localStorage.setItem(activeCdm()?DRAFT_KEY:LEGACY_DRAFT_KEY,JSON.stringify(definition));document.querySelector('#save-state').textContent='Saved on this device';toast('Draft saved on this device.');}catch(error){toast(`Draft could not be saved. ${error.message}`);}
};
document.querySelector('#import-button').onclick=()=>document.querySelector('#import-file').click();
document.querySelector('#import-file').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>500000)throw new Error('The definition file exceeds 500 KB.');
    definition=readDefinition(JSON.parse(await file.text()));changed();setView('graph');toast('Definition opened.');
  }catch(error){toast(`Could not open definition. ${error.message}`);}finally{e.target.value='';}
};
try {
  try{const saved=JSON.parse(localStorage.getItem(CONNECT_KEY));if(saved&&typeof saved==='object')connectSettings={...connectSettings,...saved};}catch(error){toast(`Connection settings could not be loaded. ${error.message}`);}
  const responses=await Promise.all([fetch('./catalog.json'),fetch('./cohort_engine.sas'),fetch('./cdm_engine.sas')]);
  if(responses.some(r=>!r.ok))throw new Error('Unable to load the schema or SAS engine.');
  rawCatalog=await responses[0].json();rawEngine=await responses[1].text();cdmEngine=await responses[2].text();activate();
  let stored;
  try{stored=localStorage.getItem(DRAFT_KEY);}catch(error){toast(`Local draft storage is unavailable. ${error.message}`);}
  if(stored){try{definition=readDefinition(JSON.parse(stored));document.querySelector('#save-state').textContent='Saved on this device';}catch(error){definition=cdm.freshDefinition();toast(`The saved draft could not be loaded. ${error.message}`);}}
  render();
} catch(error) { app.innerHTML=`<div class="error-screen"><h2>The workspace could not load.</h2><p>${esc(error.message)}</p><p>Reload this page to retry. For a local copy, start the server with <code>npm start</code>.</p></div>`; }
