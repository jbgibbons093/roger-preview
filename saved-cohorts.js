import { readDefinition } from './cohort.js?v=13d0f862af21';

export const SAVED_COHORTS_KEY='roger.saved.cohorts.v1';

export function snapshotDefinition(definition){
  const copy=readDefinition(structuredClone(definition));
  copy.outputPath='';
  return copy;
}

export function readSavedCohorts(value){
  if(!Array.isArray(value)||value.length>100)throw new Error('The saved cohort library is invalid.');
  const ids=new Set();
  return value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||!item.id||typeof item.id!=='string'||!item.name||typeof item.name!=='string'||item.name.length>120||!Number.isFinite(Date.parse(item.updatedAt)))throw new Error('A saved cohort entry is invalid.');
    if(ids.has(item.id))throw new Error('The saved cohort library contains duplicate IDs.');
    ids.add(item.id);
    const definition=snapshotDefinition(item.definition);
    return {id:item.id,name:definition.name,updatedAt:item.updatedAt,definition};
  });
}

export function upsertSavedCohort(items,id,definition,now=new Date().toISOString()){
  const snapshot=snapshotDefinition(definition);
  const cohort={id:id||crypto.randomUUID(),name:snapshot.name,updatedAt:now,definition:snapshot};
  const next=[cohort,...items.filter(item=>item.id!==cohort.id)];
  if(next.length>100)throw new Error('The saved cohort library can hold at most 100 cohorts.');
  return {items:next,cohort};
}
