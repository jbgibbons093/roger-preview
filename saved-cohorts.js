import { readDefinition, parseCodes } from './cohort.js?v=20580f35e743';
import { treeFor, logicText } from './logic.js?v=20580f35e743';
import { TABLES } from './cdm.js?v=20580f35e743';

export const SAVED_COHORTS_KEY='roger.saved.cohorts.v2';
export const LEGACY_SAVED_COHORTS_KEY='roger.saved.cohorts.v1';
export const RETIRED_COHORTS_KEY='roger.saved.retired-market-data.v1';
export const MAX_REVISIONS=50;

export async function partitionSavedCohorts(value){
  if(!Array.isArray(value)||value.length>100)throw new Error('The saved cohort library is invalid.');
  const retired=value.filter(item=>item?.definition?.schemaId==='marketscan-ccae-mdcr-2023-v1');
  const active=await readSavedCohorts(value.filter(item=>!retired.includes(item)));
  return {active,retired};
}

export function snapshotDefinition(definition){
  const copy=readDefinition(structuredClone(definition));
  copy.outputPath='';
  return copy;
}

function sorted(value){
  if(Array.isArray(value))return value.map(sorted);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])]));
  return value;
}
export function canonicalDefinition(definition){return JSON.stringify(sorted(snapshotDefinition(definition)));}
export async function definitionSha256(definition){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalDefinition(definition)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function readSavedCohorts(value){
  if(!Array.isArray(value)||value.length>100)throw new Error('The saved cohort library is invalid.');
  const ids=new Set();
  return Promise.all(value.map(async item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||!item.id||typeof item.id!=='string'||!item.name||typeof item.name!=='string'||item.name.length>120||!Number.isFinite(Date.parse(item.updatedAt)))throw new Error('A saved cohort entry is invalid.');
    if(ids.has(item.id))throw new Error('The saved cohort library contains duplicate IDs.');
    ids.add(item.id);
    const definition=snapshotDefinition(item.definition);
    let revisions;
    if(item.revisions===undefined){
      revisions=[{number:1,savedAt:item.updatedAt,author:'Legacy saved cohort',note:'Imported from the previous local library',sha256:await definitionSha256(definition),definition}];
    }else{
      if(!Array.isArray(item.revisions)||!item.revisions.length||item.revisions.length>MAX_REVISIONS)throw new Error('A cohort has an invalid revision history.');
      revisions=[];
      for(const [index,revision] of item.revisions.entries()){
        if(!revision||revision.number!==index+1||!Number.isFinite(Date.parse(revision.savedAt))||typeof revision.author!=='string'||revision.author.length>80||typeof revision.note!=='string'||revision.note.length>500||!/^[a-f0-9]{64}$/.test(revision.sha256||''))throw new Error('A saved cohort revision is invalid.');
        const snapshot=snapshotDefinition(revision.definition);
        if(await definitionSha256(snapshot)!==revision.sha256)throw new Error(`Saved cohort revision ${revision.number} failed its SHA-256 check. Restore a reviewed backup before using it.`);
        revisions.push({...revision,definition:snapshot});
      }
      if(item.revisionNumber!==revisions.length||canonicalDefinition(definition)!==canonicalDefinition(revisions.at(-1).definition))throw new Error('The saved cohort current definition does not match its latest revision.');
    }
    return {id:item.id,name:definition.name,updatedAt:revisions.at(-1).savedAt,definition,revisionNumber:revisions.length,revisions};
  }));
}

export async function upsertSavedCohort(items,id,definition,now=new Date().toISOString(),metadata={}){
  const snapshot=snapshotDefinition(definition);
  const previous=items.find(item=>item.id===id);
  if(previous&&canonicalDefinition(previous.definition)===canonicalDefinition(snapshot))return {items,cohort:previous,createdRevision:false};
  if(previous?.revisions.length>=MAX_REVISIONS)throw new Error(`This cohort has ${MAX_REVISIONS} revisions. Export its history before creating a new cohort.`);
  if(!Number.isFinite(Date.parse(now)))throw new Error('The revision timestamp is invalid.');
  const author=String(metadata.author||'Local investigator').trim().slice(0,80);
  const note=String(metadata.note||'').trim().slice(0,500);
  const revision={number:(previous?.revisions.length||0)+1,savedAt:now,author,note,sha256:await definitionSha256(snapshot),definition:snapshot};
  const cohort={id:id||crypto.randomUUID(),name:snapshot.name,updatedAt:now,definition:snapshot,revisionNumber:revision.number,revisions:[...(previous?.revisions||[]),revision]};
  const next=[cohort,...items.filter(item=>item.id!==cohort.id)];
  if(next.length>100)throw new Error('The saved cohort library can hold at most 100 cohorts.');
  return {items:next,cohort,createdRevision:true};
}

function codeList(rule){
  try{return parseCodes(rule.codes,rule.domain).map(item=>`${item.code}${item.match==='PREFIX'?'*':''}`).sort().join(', ');}
  catch{return String(rule.codes||'').trim();}
}
function list(values){return [...values].sort().join(', ')||'[none]';}
function compareFields(value){
  const d=snapshotDefinition(value),fields=[];
  const add=(label,text)=>fields.push([label,String(text)]);
  const event=(name,rule,criterion=false)=>{
    if(!rule){add(name,'[none]');return;}
    add(`${name} · code system`,rule.domain);
    add(`${name} · source tables`,list(rule.sources));
    add(`${name} · codes`,codeList(rule));
    if(rule.domain!=='NDC')add(`${name} · encounter types`,list(rule.encTypes));
    if(criterion){
      add(`${name} · eligibility`,rule.mode);
      add(`${name} · day window`,`${rule.from} through ${rule.to}`);
      add(`${name} · minimum distinct days`,rule.minDays);
    }
  };
  add('Cohort name',d.name);
  add('Delivery years',`${d.yearStart}–${d.yearEnd}`);
  add('Index dates',`${d.start} through ${d.end}`);
  add('Index ordering',d.indexOrder);
  add('Comparison mode',d.comparison?'Treatment and control':'Single index');
  if(d.comparison){
    add('Control index dates',`${d.comparison.start} through ${d.comparison.end}`);
    add('Treatment/control overlap',d.comparison.overlap);
  }
  add('Age at index',`${d.ageMin}–${d.ageMax}`);
  add('Recorded sex',d.sex);
  add('Enrollment required',d.enrollment?'Yes':'No');
  if(d.enrollment){
    add('Enrollment · baseline days',d.baseline);
    add('Enrollment · follow-up days',d.followup);
    add('Enrollment · maximum gap',d.gap);
    add('Enrollment · drug coverage',d.rx?'Required':'Unrestricted');
  }
  event('Index event',d.index);
  if(d.comparison)event('Control index event',d.comparison.controlIndex);
  add('Condition tree',logicText(treeFor(d)));
  add('Additional criterion count',d.rules.length);
  d.rules.forEach((rule,i)=>event(`Criterion ${i+1}`,rule,true));
  add('Covariate count',d.covariates.length);
  d.covariates.forEach((cov,i)=>{
    const name=`Covariate ${i+1}`;
    add(`${name} · key`,cov.key);
    add(`${name} · label`,cov.label);
    if(d.comparison)add(`${name} · arm`,cov.arm||'BOTH');
    event(name,cov);
    add(`${name} · day window`,`${cov.from} through ${cov.to}`);
    add(`${name} · minimum distinct days`,cov.minDays);
  });
  add('Extract tables',list(d.outputs));
  add('Extract window',`${d.extractBefore} days before through ${d.extractAfter} days after index`);
  add('SAS stop stage',d.stopAfter);
  add('Add-on SAS · after index',d.afterIndexSas.trim()||'[none]');
  add('Add-on SAS · after eligibility',d.afterEligibilitySas.trim()||'[none]');
  add('CDM source folder',d.inputPath||'[not set]');
  for(const table of TABLES)add(`Table mapping · ${table}`,d.mapping[table]||'[not set]');
  for(const key of Object.keys(d.graph.notes).sort()){
    add(`Canvas note · ${key}`,d.graph.notes[key]||'[none]');
  }
  return fields;
}

/** Compare runnable study specifications; run folders and canvas positions are excluded. */
export function compareDefinitions(left,right){
  const a=new Map(compareFields(left)),b=new Map(compareFields(right));
  const fields=[...new Set([...a.keys(),...b.keys()])];
  return fields.filter(field=>(a.get(field)||'[none]')!==(b.get(field)||'[none]'))
    .map(field=>({field,left:a.get(field)||'[none]',right:b.get(field)||'[none]'}));
}

export function comparisonReport(left,right){
  const changes=compareDefinitions(left.definition,right.definition);
  return [`SAVED COHORT COMPARISON`,
    `A: ${left.name} · ${left.updatedAt}`,
    `B: ${right.name} · ${right.updatedAt}`,
    `${changes.length} changed field${changes.length===1?'':'s'}`,
    ...changes.flatMap(change=>['',change.field,`A: ${change.left}`,`B: ${change.right}`])].join('\n')+'\n';
}
