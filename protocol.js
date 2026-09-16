import { treeFor, logicText, usesOr } from './logic.js';
import { validateDefinition, parseCodes } from './cohort.js';

export function selectionProtocol(d,catalog){
  const errors=validateDefinition(d), tree=treeFor(d), order=d.indexOrder==='LAST'?'last':'first';
  const event=(r,i)=>{
    let codes;
    try{codes=parseCodes(r.codes,r.domain).map(c=>c.code+(c.match==='PREFIX'?'*':'')).join(', ');}catch{codes=r.codes;}
    return `${i===0?'Index event':`Criterion ${i}`}\n${catalog.domains[r.domain].label}. Sources: ${r.sources.map(t=>`${t} (${catalog.tables[t].label})`).join(', ')}.\n${i===0?`Select the ${order} matching event between ${d.start} and ${d.end}, inclusive.`:`${r.mode==='INCLUDE'?'Require':'Exclude people with'} at least ${r.minDays} distinct event day(s) from day ${r.from} through day ${r.to}, inclusive, relative to index.`}\nCode list (OR within the list): ${codes||'[codes required]'}`;
  };
  return [
    'STUDY POPULATION SELECTION PROTOCOL',d.name,
    `Definition specification • MarketScan 2023 • ${d.schemaId}`,
    errors.length?`DRAFT. Resolve before execution\n${errors.map(e=>'- '+e).join('\n')}`:'Definition validated for program generation. SAS execution and population counts are pending.',
    'SOURCE POPULATION',`MarketScan ${catalog.families[d.family]}, 2023, delivery Set ${d.edition}. Commercial and Medicare deliveries are evaluated separately.`,
    'INDEX AND SELECTION ORDER',
    `One index event per person is selected using the ${order} matching date in the index window. Same-day ties use source table letter and then SEQNUM in ascending order. Demographic, enrollment, and condition-tree filters are applied after that event is chosen. A person who fails a later filter is removed. Another candidate index event is not substituted.`,
    event(d.index,0),
    'DEMOGRAPHIC REQUIREMENTS',`Reported AGE on the index record must be between ${d.ageMin} and ${d.ageMax}, inclusive. Missing ages are excluded. Age 100 represents 100 and older. Recorded sex ${d.sex==='ALL'?'has no additional restriction':`must equal ${d.sex} (${d.sex==='1'?'male':'female'})`}.`,
    'OBSERVATION AND ENROLLMENT',d.enrollment?`Enrollment must cover index minus ${d.baseline} days through index plus ${d.followup} days, inclusive. Both endpoints must be covered. Overlapping or adjacent intervals are merged. Each internal gap may be at most ${d.gap} day(s). ${d.rx?'Only enrollment intervals with RX=1 contribute coverage.':'Pharmacy capture is not an enrollment requirement.'}`:'Continuous enrollment is not required.',
    'CONDITION TREE',logicText(tree),
    'AND requires every child condition. OR requires at least one child condition. An exclusion criterion passes when its event-day threshold is not reached. Parentheses define grouping. These conditions are evaluated for the same person relative to the selected index date.',
    ...d.rules.map((r,i)=>event(r,i+1)),
    'MATCHING CONVENTIONS',
    'Codes within each list use OR. A trailing * denotes a prefix match. Exact codes remain exact. Dots and spaces in claim code values are normalized. ICD-10-CM uses DXVER=0. Service procedures use PROC1 and PROCTYP=1 for CPT, 7 for HCPCS, and 0 for ICD-10-PCS. Admission ICD-10-PCS searches PROC1 through PROC15 and requires seven-character PCS values. MS-DRG uses the recorded numeric DRG field, padded to three digits, with the dictionary’s version 41.0. NDC uses exact 11-digit NDCNUM values, preserving leading zeros. Admission event dates use ADMDATE. Other event dates use SVCDATE. Repeated events count distinct dates across sources.',
    'CODE VERSIONS',
    'The bundled ICD and HCPCS catalogs cover releases during calendar 2023. Their release labels are reference metadata. Selecting a code does not impose extra effective-date restrictions. The claim event windows control dates. Local catalogs require separate year verification. MarketScan masking and grouping can affect observed diagnosis codes.',
    'OUTPUTS',`Export one row per selected ENROLID plus the definition, rules, code sets, and attrition. ${d.outputs.length?`Extract tables ${d.outputs.join(', ')} from index minus ${d.extractBefore} days through index plus ${d.extractAfter} days. Extracts include all records in the window for selected people, including records unrelated to the defining code lists. Enrollment extracts retain original interval endpoints.`:'No claim extracts requested.'}`,
    'ATTRITION',usesOr(tree)?'SAS reports counts after index selection, demographic filtering, enrollment when required, and the combined condition tree. Branches overlap, so branch counts are not represented as sequential removals.':'SAS reports counts after index selection, demographic filtering, enrollment when required, and each criterion in its numbered order.',
    'ANNOTATIONS',...Object.entries(d.graph?.notes||{}).filter(([,note])=>note.trim()).map(([key,note])=>`${/^r\d+$/.test(key)?`Criterion ${Number(key.slice(1))+1}`:key}\n${note}`),
    'SAS TABLE MAPPINGS',...Object.entries(d.mapping).filter(([,value])=>value).map(([table,value])=>`${table} = ${value}`),
    'STATUS', 'This protocol describes the configured selection algorithm. Counts, execution validation, and study results must be added after the SAS run. All observation windows in this profile must fit within calendar 2023.'
  ].join('\n\n')+'\n';
}
