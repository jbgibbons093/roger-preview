import * as cdm from './cdm.js';
import { treeFor, logicIssues, logicText, usesOr } from './logic.js';
export const TABLES = ['O', 'S', 'I', 'F', 'D', 'T'];
export const DOMAINS = { DX: ['O', 'S', 'I', 'F'], PCS: ['I', 'S', 'O'], CPT: ['O', 'S'], HCPCS: ['O', 'S'], DRG: ['I', 'S'], NDC: ['D'] };
export const schemaId = 'marketscan-ccae-mdcr-2023-v1';
export function freshDefinition() {
  return {
    schemaId, name: 'Untitled cohort', family: 'CCAE', edition: 'A',
    start: '2023-04-01', end: '2023-12-31', ageMin: 18, ageMax: 64, sex: 'ALL',
    enrollment: true, baseline: 90, followup: 0, gap: 0, rx: false,
    index: { domain: 'DX', sources: ['O', 'S'], codes: '' }, rules: [],
    extractBefore: 90, extractAfter: 0, outputs: ['O', 'D', 'T'],
    mapping: Object.fromEntries(TABLES.map(t => [t, ''])), inputPath: '', outputPath: '',
    indexOrder: 'FIRST', logic: null, graph: {positions:{},notes:{}}
  };
}
export function parseCodes(text, domain) {
  const tokens = text.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const seen = new Set();
  return tokens.map(token => {
    const prefix = token.endsWith('*');
    const normalized = token.replace(/\./g, '').replace(/\*$/, '');
    if (!/^[A-Z0-9]+$/.test(normalized)) throw new Error(`Invalid code ${token}. Use letters, digits, dots, and a trailing *.`);
    if (domain === 'DX9' && !/^(?:[0-9]{3,5}|V[0-9]{2,4}|E[0-9]{3,4})$/.test(normalized)) throw new Error(`Check ICD-9-CM diagnosis ${token}. Preserve leading zeros.`);
    if (domain === 'PX9' && !/^[0-9]{2,4}$/.test(normalized)) throw new Error(`Check ICD-9-CM procedure ${token}. Use 2–4 digits, preserving leading zeros.`);
    if (domain === 'DX' && !/^[A-Z][0-9][A-Z0-9]{1,5}$/.test(normalized)) throw new Error(`Diagnosis ${token} must contain 3–7 characters in ICD-10-CM format.`);
    if (domain === 'PCS' && !(prefix ? /^[0-9A-HJ-NP-Z]{3,7}$/ : /^[0-9A-HJ-NP-Z]{7}$/).test(normalized)) throw new Error(`Check ICD-10-PCS ${token}. Exact codes contain seven characters. Families require at least three.`);
    if (domain === 'DRG' && (!/^\d{3}$/.test(normalized) || prefix)) throw new Error('MS-DRG codes require three digits, including leading zeros. Use exact codes.');
    if (domain === 'CPT' && !(prefix ? /^[0-9A-Z]{2,5}$/ : /^[0-9]{4}[0-9A-Z]$/).test(normalized)) throw new Error(`Check the CPT code ${token}. Exact codes contain five characters.`);
    if (domain === 'HCPCS' && !(prefix ? /^[A-Z][0-9]{1,4}$/ : /^[A-Z][0-9]{4}$/).test(normalized)) throw new Error(`Check the HCPCS code ${token}. Exact codes contain a letter and four digits.`);
    if (domain === 'NDC' && (!/^\d{11}$/.test(normalized) || prefix)) throw new Error('NDC codes must contain exactly 11 digits, including leading zeros. Use exact codes.');
    return { code: normalized, match: prefix ? 'PREFIX' : 'EXACT' };
  }).filter(item => { const key = item.code + item.match; if (seen.has(key)) return false; seen.add(key); return true; });
}
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const validDate = value => /^2023-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
// Drafts may be unfinished, but their structure must be safe to render and edit.
export function readDefinition(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Expected a cohort definition object.');
  const base = cdm.isCdm(candidate) ? cdm.freshDefinition() : freshDefinition();
  const tables = cdm.isCdm(candidate) ? cdm.TABLES : TABLES;
  const domains = cdm.isCdm(candidate) ? cdm.DOMAINS : DOMAINS;
  // Older definitions use the original first-index, all-AND semantics.
  candidate={indexOrder:'FIRST',logic:null,graph:{positions:{},notes:{}},...(cdm.isCdm(candidate)?{stopAfter:'DELIVER',afterIndexSas:'',afterEligibilitySas:''}:{}),...candidate};
  if (candidate.schemaId !== base.schemaId) throw new Error('This definition requires a different year or schema version.');
  for (const [key, value] of Object.entries(base)) {
    if (!Object.hasOwn(candidate, key)) throw new Error(`Missing definition field ${key}.`);
    if (typeof value === 'string' && (typeof candidate[key] !== 'string' || candidate[key].length > (key.endsWith('Sas')?10000:1000))) throw new Error(`Invalid text field ${key}.`);
    if (typeof value === 'number' && candidate[key] !== null && !Number.isFinite(candidate[key])) throw new Error(`Invalid numeric field ${key}.`);
    if (typeof value === 'boolean' && typeof candidate[key] !== 'boolean') throw new Error(`Invalid option ${key}.`);
  }
  for (const [key, choices] of Object.entries(cdm.isCdm(candidate)?{family:['CDM'],edition:['3.0'],sex:['ALL','M','F','A','U']}:{family:['CCAE','MDCR'],edition:['A','B'],sex:['ALL','1','2']})) if (!choices.includes(candidate[key])) throw new Error(`Unsupported ${key}.`);
  if (!Array.isArray(candidate.rules) || candidate.rules.length > 20) throw new Error('Expected up to 20 eligibility criteria.');
  if(!['FIRST','LAST'].includes(candidate.indexOrder))throw new Error('Choose first or last matching index event.');
  if(candidate.logic!==null){const issues=logicIssues(candidate.logic,candidate.rules.length,true);if(issues.length)throw new Error(issues[0]);}
  if(!candidate.graph||typeof candidate.graph!=='object')throw new Error('Invalid graph metadata.');
  for(const kind of ['positions','notes']){
    const values=candidate.graph[kind];
    if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length>70)throw new Error('Invalid graph metadata.');
    for(const [key,value] of Object.entries(values)){
      if(!/^(population|index|demographics|enrollment|output|r\d{1,2}|g\d{1,3})$/.test(key))throw new Error('Invalid graph node.');
      if(kind==='notes'?(typeof value!=='string'||value.length>4000):(!value||!['x','y'].every(axis=>Number.isFinite(value[axis])&&value[axis]>=0&&value[axis]<=20000)))throw new Error('Invalid node note or position.');
    }
  }
  for (const [i, r] of [candidate.index,...candidate.rules].entries()) {
    if (!r || !Object.hasOwn(domains,r.domain) || typeof r.codes !== 'string' || r.codes.length > 20000) throw new Error('Invalid event definition.');
    if (!Array.isArray(r.sources) || r.sources.some(t=>!domains[r.domain].includes(t)) || new Set(r.sources).size !== r.sources.length) throw new Error('Invalid claim sources.');
    if (cdm.isCdm(candidate) && (!Array.isArray(r.encTypes) || r.encTypes.some(t=>!Object.hasOwn(cdm.ENC_TYPES,t)) || new Set(r.encTypes).size!==r.encTypes.length)) throw new Error('Invalid encounter types.');
    if (i && (!['INCLUDE','EXCLUDE'].includes(r.mode) || ['from','to','minDays'].some(k=>r[k] !== null && !Number.isFinite(r[k])))) throw new Error('Invalid eligibility rule.');
  }
  if (!Array.isArray(candidate.outputs) || candidate.outputs.some(t=>!tables.includes(t)) || new Set(candidate.outputs).size !== candidate.outputs.length) throw new Error('Invalid output tables.');
  if (!candidate.mapping || tables.some(t=>typeof candidate.mapping[t] !== 'string' || candidate.mapping[t].length > 1000)) throw new Error('Invalid table mappings.');
  // Retain only supported fields. Unknown JSON properties cannot alter the UI.
  const result = Object.fromEntries(Object.keys(base).map(k=>[k,candidate[k]]));
  return structuredClone(result);
}
export function validateDefinition(d) {
  try { readDefinition(d); } catch (error) { return [error.message]; }
  if (cdm.isCdm(d)) return cdm.validate(d,parseCodes);
  const errors = [];
  errors.push(...logicIssues(treeFor(d),d.rules.length));
  if (d.schemaId !== schemaId) errors.push('This builder supports the 2023 Commercial and Medicare schema.');
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 120 || /[\x00-\x1f]/.test(d.name)) errors.push('Enter a cohort name of 1–120 characters.');
  if (!['CCAE', 'MDCR'].includes(d.family)) errors.push('Choose Commercial or Medicare.');
  if (!['A', 'B'].includes(d.edition)) errors.push('Choose Set A or Set B.');
  if (!validDate(d.start) || !validDate(d.end) || d.start > d.end) errors.push('Enter an ordered index date range within 2023.');
  if (!isInt(d.ageMin, 0, 100) || !isInt(d.ageMax, 0, 100) || d.ageMin > d.ageMax) errors.push('Reported ages must be ordered whole numbers from 0 through 100.');
  if (!['ALL', '1', '2'].includes(d.sex)) errors.push('Choose a supported sex filter.');
  for (const key of ['baseline', 'followup', 'gap', 'extractBefore', 'extractAfter']) if (!isInt(d[key], 0, 365)) errors.push(`${key} must be a whole number from 0 through 365.`);
  if (typeof d.enrollment !== 'boolean' || typeof d.rx !== 'boolean') errors.push('Enrollment options must be true or false.');
  if (d.rx && !d.enrollment) errors.push('Enable enrollment requirements to require pharmacy capture.');
  if (!Array.isArray(d.rules) || d.rules.length > 20) errors.push('A cohort can contain up to 20 additional criteria.');
  const rules = Array.isArray(d.rules) ? d.rules : [];
  [d.index, ...rules].forEach((r, i) => {
    const label = i === 0 ? 'Index event' : `Criterion ${i}`;
    if (!r || !Object.hasOwn(DOMAINS, r.domain)) { errors.push(`${label} needs a supported code system.`); return; }
    if (!Array.isArray(r.sources) || !r.sources.length || r.sources.some(t => !DOMAINS[r.domain].includes(t)) || new Set(r.sources).size !== r.sources.length) errors.push(`${label} needs compatible, unique claim sources.`);
    try { const codes = parseCodes(r.codes, r.domain); if (!codes.length || codes.length > 500) errors.push(`${label} needs 1–500 codes.`); }
    catch (e) { errors.push(`${label}. ${e.message}`); }
    if (i && (!['INCLUDE', 'EXCLUDE'].includes(r.mode) || !isInt(r.minDays, 1, 366) || !isInt(r.from, -365, 365) || !isInt(r.to, -365, 365) || r.from > r.to)) errors.push(`${label} needs an ordered day window and a positive number of distinct days.`);
    if (i && r.minDays > r.to - r.from + 1) errors.push(`${label} requests more event days than its window contains.`);
  });
  if (!Array.isArray(d.outputs) || d.outputs.some(t => !TABLES.includes(t)) || new Set(d.outputs).size !== d.outputs.length) errors.push('Select valid, unique output tables.');
  for (const table of TABLES) {
    const value = d.mapping?.[table];
    if (typeof value !== 'string' || (value && !/^[A-Za-z_][A-Za-z0-9_]{0,7}\.[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(value))) errors.push(`Mapping ${table} must use LIBREF.TABLE syntax.`);
    if (typeof value === 'string' && /^WORK\._RG_/i.test(value)) errors.push(`Mapping ${table} uses the reserved WORK._RG_ namespace.`);
  }
  for (const key of ['inputPath', 'outputPath']) if (typeof d[key] !== 'string' || /[\x00-\x1f]/.test(d[key]) || d[key].length > 250) errors.push('Library paths must be a single line of at most 250 characters.');
  if (validDate(d.start) && validDate(d.end)) {
    const before = Math.max(d.enrollment ? d.baseline : 0, d.outputs.length ? d.extractBefore : 0, ...rules.map(r => -r.from), 0);
    const after = Math.max(d.enrollment ? d.followup : 0, d.outputs.length ? d.extractAfter : 0, ...rules.map(r => r.to), 0);
    if (Date.parse(d.start) - before * 86400000 < Date.parse('2023-01-01') || Date.parse(d.end) + after * 86400000 > Date.parse('2023-12-31')) errors.push('A requested observation window extends outside 2023. Narrow the index dates or shorten the window.');
  }
  return errors;
}
export function requiredTables(d) {
  if (cdm.isCdm(d)) return cdm.requiredTables(d);
  return TABLES.filter(t => [d.index, ...d.rules].some(r => r.sources.includes(t)) || d.outputs.includes(t) || (t === 'T' && d.enrollment));
}
export function connectionIssues(d) {
  return requiredTables(d).filter(t => !d.mapping[t]).map(t => `Map table ${t} to its SAS dataset.`);
}
const quote = text => `'${String(text).replace(/'/g, "''")}'`;
export function compileSas(d, engine) {
  const errors = validateDefinition(d);
  if (errors.length) throw new Error(errors.join('\n'));
  if (cdm.isCdm(d)) return cdm.compile(d,engine,parseCodes);
  if (!engine.includes('%macro roger_cut;')) throw new Error('The SAS engine could not be loaded.');
  const rules = [{ ...d.index, mode: 'INDEX', minDays: 1, from: 0, to: 0 }, ...d.rules];
  const ruleLines = rules.map((r, i) => `${i + 1}|${r.mode}|${r.domain}|${r.sources.join(' ')}|${r.minDays}|${r.from}|${r.to}`).join('\n');
  const codeLines = rules.flatMap((r, i) => parseCodes(r.codes, r.domain).map(c => `${i + 1}|${c.code}|${c.match}`)).join('\n');
  const parameters = { age_min: d.ageMin, age_max: d.ageMax, sex: d.sex, enrollment: +d.enrollment, baseline: d.baseline, followup: d.followup, gap: d.gap, rx: +d.rx, extract_before: d.extractBefore, extract_after: d.extractAfter, outputs: d.outputs.join(' '), outlib: d.outputPath ? 'RGCUT' : 'WORK' };
  const missing = connectionIssues(d).length;
  const tree=treeFor(d), advanced=usesOr(tree), order=d.indexOrder||'FIRST';
  return `/* Generated by ROGER. MarketScan 2023. SAS 9.4.
   Run in your approved SAS environment. Review the definition and mappings.
   ${order==='LAST'?'Last':'First'} matching event in the index window is selected BEFORE later filters.
   Ties use source table letter then SEQNUM. One row per ENROLID.
   Distinct service days determine repeated-event criteria.
   This program has not been executed by the browser.
   ${missing ? 'CONFIGURATION REQUIRED. Supply the missing table mappings below.' : 'Mappings supplied. Verify they identify the intended database and edition.'}
*/
options errorabend;
${d.inputPath ? `libname MS ${quote(d.inputPath)} access=readonly;` : '/* Assign your input librefs before running, or add a LIBNAME statement here. */'}
${d.outputPath ? `libname RGCUT ${quote(d.outputPath)};` : '/* Outputs will be created in WORK for this SAS session. */'}
${TABLES.map(t => `%let map_${t}=${d.mapping[t]};`).join('\n')}
${Object.entries(parameters).map(([k, v]) => `%let ${k}=${v};`).join('\n')}
%let index_order=${order};
%let advanced_logic=${+advanced};
%let index_start=%sysfunc(inputn(${d.start.replaceAll('-', '')},yymmdd8.));
%let index_end=%sysfunc(inputn(${d.end.replaceAll('-', '')},yymmdd8.));

data work._rg_definition;
  length name $120 schema_id $40 family $4 edition $1 input_path output_path $250;
  name=${quote(d.name)};
  schema_id=${quote(schemaId)};
  family=${quote(d.family)};
  edition=${quote(d.edition)};
  data_year=2023;
  length index_order $5 logic_json $12000;
  index_order=${quote(order)};
  logic_json=${quote(JSON.stringify(tree))};
  created_at=datetime();
  format created_at datetime20. index_start index_end yymmdd10.;
  index_start=&index_start;
  index_end=&index_end;
  input_path=${quote(d.inputPath)};
  output_path=${quote(d.outputPath)};
${Object.entries(parameters).map(([k,v])=>`  ${k}=${typeof v === 'number' ? v : quote(v)};`).join('\n')}
${TABLES.map(t=>`  length map_${t} $41; map_${t}=${quote(d.mapping[t])};`).join('\n')}
run;
data work._rg_rules;
  length rule_id min_days lower_day upper_day 8 mode $7 domain $5 sources $12;
  infile datalines4 dlm='|' dsd truncover;
  input rule_id mode :$7. domain :$5. sources :$12. min_days lower_day upper_day;
datalines4;
${ruleLines}
;;;;
run;
data work._rg_codes;
  length rule_id 8 code $11 match_type $6;
  infile datalines4 dlm='|' dsd truncover;
  input rule_id code :$11. match_type :$6.;
datalines4;
${codeLines}
;;;;
run;

%macro rg_apply_logic;
  data work._rg_cohort;
    set work._rg_cohort;
    ${d.rules.length?`if ${logicText(tree,i=>`_rg_pass_${i+2}=1`)};`:''}
    drop _rg_pass_:;
  run;
%mend;

${engine}

%macro rg_check_mappings;
${requiredTables(d).map(t => `  %if %length(%superq(map_${t}))=0 %then %do;
    %put ERROR: Set map_${t} to the actual SAS dataset before running.;
    %abort cancel;
  %end;`).join('\n')}
%mend;
%rg_check_mappings;
%roger_cut;
`;
}
