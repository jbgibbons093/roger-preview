import * as cdm from './cdm.js?v=dce5f8e2fe76';
import { logicIssues } from './logic.js?v=dce5f8e2fe76';

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

// Imported definitions must belong to the institutional CDM. Unsupported older
// data models are rejected instead of being silently reinterpreted.
export function readDefinition(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Expected a cohort definition object.');
  if (!cdm.isCdm(candidate)) throw new Error('Only Mini-Sentinel CDM definitions are supported.');
  const base = cdm.freshDefinition();
  const tables = cdm.TABLES, domains = cdm.DOMAINS;
  candidate={indexOrder:'FIRST',logic:null,graph:{positions:{},notes:{}},stopAfter:'DELIVER',afterIndexSas:'',afterEligibilitySas:'',covariates:[],...candidate};
  for (const [key, value] of Object.entries(base)) {
    if (!Object.hasOwn(candidate, key)) throw new Error(`Missing definition field ${key}.`);
    if (typeof value === 'string' && (typeof candidate[key] !== 'string' || candidate[key].length > (key.endsWith('Sas')?10000:1000))) throw new Error(`Invalid text field ${key}.`);
    if (typeof value === 'number' && candidate[key] !== null && !Number.isFinite(candidate[key])) throw new Error(`Invalid numeric field ${key}.`);
    if (typeof value === 'boolean' && typeof candidate[key] !== 'boolean') throw new Error(`Invalid option ${key}.`);
  }
  for (const [key, choices] of Object.entries({family:['CDM'],edition:['3.0'],sex:['ALL','M','F','A','U']})) if (!choices.includes(candidate[key])) throw new Error(`Unsupported ${key}.`);
  if (!Array.isArray(candidate.rules) || candidate.rules.length > 20) throw new Error('Expected up to 20 eligibility criteria.');
  if(!Array.isArray(candidate.covariates)||candidate.covariates.length>20)throw new Error('Expected up to 20 covariates.');
  for(const r of candidate.covariates){
    if(!r||typeof r.key!=='string'||r.key.length>20||typeof r.label!=='string'||r.label.length>80||!Object.hasOwn(domains,r.domain)||typeof r.codes!=='string'||r.codes.length>20000||!Array.isArray(r.sources)||r.sources.length!==1||r.sources[0]!==domains[r.domain][0]||!Array.isArray(r.encTypes)||r.encTypes.some(t=>!Object.hasOwn(cdm.ENC_TYPES,t))||['from','to','minDays'].some(k=>!Number.isFinite(r[k]))||r.arm!==undefined&&!['BOTH','TREATMENT','CONTROL'].includes(r.arm)||r.predictor!==undefined&&typeof r.predictor!=='boolean')throw new Error('Invalid covariate definition.');
  }
  if(candidate.outcomes!==undefined){
    if(!Array.isArray(candidate.outcomes)||candidate.outcomes.length>20)throw new Error('Expected up to 20 outcomes.');
    for(const r of candidate.outcomes)if(!r||typeof r.key!=='string'||r.key.length>20||typeof r.label!=='string'||r.label.length>80||!Object.hasOwn(domains,r.domain)||typeof r.codes!=='string'||r.codes.length>20000||!Array.isArray(r.sources)||r.sources.length!==1||r.sources[0]!==domains[r.domain][0]||!Array.isArray(r.encTypes)||r.encTypes.some(t=>!Object.hasOwn(cdm.ENC_TYPES,t))||!Number.isFinite(r.from)||!Number.isFinite(r.to))throw new Error('Invalid outcome definition.');
  }
  if(candidate.predictors!==undefined&&(!candidate.predictors||typeof candidate.predictors!=='object'||Array.isArray(candidate.predictors)||typeof candidate.predictors.age!=='boolean'||typeof candidate.predictors.sex!=='boolean'))throw new Error('Invalid built-in predictor selection.');
  if(candidate.comparison!==undefined){
    const comparison=candidate.comparison;
    if(!comparison||typeof comparison!=='object'||Array.isArray(comparison)||typeof comparison.start!=='string'||typeof comparison.end!=='string'||!['EARLIEST','EXCLUDE'].includes(comparison.overlap)||!comparison.controlIndex)throw new Error('Invalid treatment/control comparison.');
    const r=comparison.controlIndex;
    if(!Object.hasOwn(domains,r.domain)||typeof r.codes!=='string'||r.codes.length>20000||!Array.isArray(r.sources)||r.sources.length!==1||r.sources[0]!==domains[r.domain][0]||!Array.isArray(r.encTypes)||r.encTypes.some(t=>!Object.hasOwn(cdm.ENC_TYPES,t))||new Set(r.encTypes).size!==r.encTypes.length)throw new Error('Invalid control index definition.');
  }else if(candidate.covariates.some(r=>r.arm&&r.arm!=='BOTH'))throw new Error('Arm-specific covariates require a treatment/control comparison.');
  if(!['FIRST','LAST'].includes(candidate.indexOrder))throw new Error('Choose first or last matching index event.');
  if(candidate.logic!==null){const issues=logicIssues(candidate.logic,candidate.rules.length,true);if(issues.length)throw new Error(issues[0]);}
  if(!candidate.graph||typeof candidate.graph!=='object')throw new Error('Invalid graph metadata.');
  for(const kind of ['positions','notes']){
    const values=candidate.graph[kind];
    if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length>70)throw new Error('Invalid graph metadata.');
    for(const [key,value] of Object.entries(values)){
      if(!/^(population|index|controlIndex|demographics|enrollment|covariates|outcomes|output|r\d{1,2}|g\d{1,3})$/.test(key))throw new Error('Invalid graph node.');
      if(kind==='notes'?(typeof value!=='string'||value.length>4000):(!value||!['x','y'].every(axis=>Number.isFinite(value[axis])&&value[axis]>=0&&value[axis]<=20000)))throw new Error('Invalid node note or position.');
    }
  }
  for (const [i, r] of [candidate.index,...candidate.rules].entries()) {
    if (!r || !Object.hasOwn(domains,r.domain) || typeof r.codes !== 'string' || r.codes.length > 20000) throw new Error('Invalid event definition.');
    if (!Array.isArray(r.sources) || r.sources.some(t=>!domains[r.domain].includes(t)) || new Set(r.sources).size !== r.sources.length) throw new Error('Invalid claim sources.');
    if (!Array.isArray(r.encTypes) || r.encTypes.some(t=>!Object.hasOwn(cdm.ENC_TYPES,t)) || new Set(r.encTypes).size!==r.encTypes.length) throw new Error('Invalid encounter types.');
    if (i && (!['INCLUDE','EXCLUDE'].includes(r.mode) || ['from','to','minDays'].some(k=>r[k] !== null && !Number.isFinite(r[k])))) throw new Error('Invalid eligibility rule.');
  }
  if (!Array.isArray(candidate.outputs) || candidate.outputs.some(t=>!tables.includes(t)) || new Set(candidate.outputs).size !== candidate.outputs.length) throw new Error('Invalid output tables.');
  if (!candidate.mapping || tables.some(t=>typeof candidate.mapping[t] !== 'string' || candidate.mapping[t].length > 1000)) throw new Error('Invalid table mappings.');
  const result=Object.fromEntries(Object.keys(base).map(k=>[k,candidate[k]]));
  if(candidate.comparison!==undefined)result.comparison=candidate.comparison;
  if(candidate.outcomes!==undefined)result.outcomes=candidate.outcomes;
  if(candidate.predictors!==undefined)result.predictors=candidate.predictors;
  return structuredClone(result);
}

export function validateDefinition(definition) {
  try { readDefinition(definition); } catch (error) { return [error.message]; }
  return cdm.validate(definition,parseCodes);
}
export const requiredTables = definition => cdm.requiredTables(definition);
export const connectionIssues = definition => requiredTables(definition).filter(table=>!definition.mapping[table]).map(table=>`Map table ${table} to its SAS dataset.`);
export function compileSas(definition,engine) {
  const errors=validateDefinition(definition);
  if(errors.length)throw new Error(errors.join('\n'));
  return cdm.compile(definition,engine,parseCodes);
}
