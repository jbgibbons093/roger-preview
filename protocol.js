import { treeFor, logicText, usesOr } from './logic.js?v=03cca2a56ddb';
import { validateDefinition, parseCodes } from './cohort.js?v=03cca2a56ddb';
import { requiredTables, expandMapping } from './cdm.js?v=03cca2a56ddb';

export function selectionProtocol(d,catalog){
  const errors=validateDefinition(d),tree=treeFor(d),order=d.indexOrder==='LAST'?'last':'first';
  const event=(r,i)=>{
    let codes;
    try{codes=parseCodes(r.codes,r.domain).map(c=>c.code+(c.match==='PREFIX'?'*':'')).join(', ');}catch{codes=r.codes;}
    return `${i?`Criterion ${i}`:'Index event'}\n${catalog.domains[r.domain].label}. ${catalog.domains[r.domain].matching}. Source ${r.sources.map(t=>catalog.tables[t].label).join(', ')}.\n${r.domain==='NDC'?'Date is RxDate.':`Date is ADate. Accepted EncType values are ${r.encTypes.join(', ')}.`}\n${i?`${r.mode==='INCLUDE'?'Require':'Exclude people with'} at least ${r.minDays} distinct event day(s) from index day ${r.from} through ${r.to}, inclusive.`:`Select the ${order} matching event between ${d.start} and ${d.end}, inclusive.`}\nCodes, combined with OR: ${codes||'[codes required]'}`;
  };
  let files;
  try{
    if(!Number.isInteger(d.yearStart)||!Number.isInteger(d.yearEnd)||d.yearEnd<d.yearStart||d.yearEnd-d.yearStart>=100)throw new Error('Check years');
    files=requiredTables(d).flatMap(t=>expandMapping(d,t)).map(r=>`${r.table}${r.year?' '+r.year:''} = ${r.dataset||'[mapping required]'}`);
  }catch{files=['Resolve delivery years to expand filenames.'];}
  return [
    'STUDY POPULATION SELECTION PROTOCOL',d.name,
    `Mini-Sentinel Common Data Model v3.0 • ${d.schemaId}`,
    errors.length?`DRAFT. Resolve before execution\n${errors.map(e=>'- '+e).join('\n')}`:'Definition validated for program generation. SAS execution and population counts are pending.',
    'SOURCE AND DELIVERY',
    `Institutional Mini-Sentinel CDM files for delivery years ${d.yearStart} through ${d.yearEnd}. CDM concepts follow the supplied Mini-Sentinel_Common-Data-Model.pdf v3.0. The inspected 2013–2023 delivery inventory supplies the default filenames and actual field types. Other delivery years require verification. Required annual tables are scanned across every configured year using the record date. File-year labels describe provenance and impose no separate calendar-year filter on records.`,
    'INDEX AND SELECTION ORDER',
    `Select one ${order} matching index date per PatID. SAS retains the identifier type from the source and requires the same type across selected tables. Same-day ties use source filename, EncounterID, and normalized code in ascending order. Apply demographic, enrollment, and condition-tree filters after choosing index. Failure removes the person without substituting another candidate date. Character identifiers retain leading zeros when present.`,
    event(d.index,0),
    'DEMOGRAPHIC REQUIREMENTS',
    `Join Demographic by PatID. Repeated demographic rows for an index-selected PatID stop eligibility before filtering continues. Age is completed years from recorded Birth_Date through index_date, calculated with SAS INTCK('year',Birth_Date,index_date,'c'). Age must be ${d.ageMin} through ${d.ageMax}, inclusive. Missing demographic records, missing birth dates, and birth dates after index are excluded. Recorded Sex ${d.sex==='ALL'?'has no additional restriction':`must equal '${d.sex}'`}.`,
    'OBSERVATION AND ENROLLMENT',
    d.enrollment?`Require coverage from index minus ${d.baseline} days through index plus ${d.followup} days, inclusive. Use Enr_Start and Enr_End intervals with MedCov='Y'${d.rx?" and DrugCov='Y'":''}. Both endpoints must be covered. Overlapping and adjacent intervals contribute their union. Each internal uncovered gap may be at most ${d.gap} days, including any gap in required drug coverage. N and U values never contribute required coverage. ${d.rx?'Drug coverage is required.':'Drug coverage is unrestricted.'}`:'Enrollment is unrestricted for cohort selection.',
    'The Enrollment_abd rollup must expose the inspected interval fields. SAS preflight checks required field names, types, and consistent PatID type. Actual content, date units, completeness, and CDM conformance require institutional validation. Death dates never shorten enrollment in this definition.',
    'CONDITION TREE',logicText(tree),
    'AND requires every child. OR requires at least one child. An exclusion passes when its event-day threshold is not reached. All leaves refer to the same person and selected index date. Distinct dates are counted across the selected annual files. Duplicate rows or overlapping annual deliveries on the same date contribute one event day.',
    ...d.rules.map((r,i)=>event(r,i+1)),
    'MATCHING AND CODE VERSIONS',
    'Exact matches and trailing-asterisk prefix matches are distinct. Dots and spaces in record codes are removed for matching. Diagnosis and Procedure use their own ADate and EncType, preserving records without a linked Encounter. ICD-9 and ICD-10 use separate code-type values. The supplied v3.0 dictionary labels PX_CodeType=10 as ICD-10-CM. The PCS option uses that procedure slot plus a seven-character PCS format check, a convention to verify against the delivery. MS-DRG uses the recorded character DRG with DRG_Type=2, preserving three digits. The program does not assign a grouper version or recalculate DRGs. Dispensing uses its exact 11-digit NDC and RxDate. Procedure records tagged ND are outside the Dispensing domain.',
    'Bundled diagnosis, PCS, HCPCS, and MS-DRG reference menus cover 2023 releases only. Earlier or later descriptions require a suitable local catalog or manual code entry and year-specific verification. Selecting a reference entry imposes no effective-date filter. Record dates and the explicit study windows govern selection. ICD-11, SNOMED, revenue, and other CDM code types are outside the currently supported event menus.',
    'SAS STAGES AND ADD-ON CODE',
    `Run through ${d.stopAfter}. Index selection writes WORK._RG_COHORT and reports people and index dates. Eligibility consumes that cohort and reports attrition. Both checkpoints print the first 100 selected rows with identifiers omitted. Final delivery writes requested outputs and prints the first 100 rows of COHORT_PREVIEW. Add-on code after index selection: ${d.afterIndexSas.trim()||'[none]'}`,
    `Add-on code after eligibility: ${d.afterEligibilitySas.trim()||'[none]'}. SAS checks that each add-on preserves one row per PatID and nonmissing PatID/index_date. Review custom code and its effects before interpreting counts.`,
    'BASELINE COVARIATES',
    ...(d.covariates?.length?d.covariates.map(r=>`${r.label} (cov_${r.key}). ${catalog.domains[r.domain].label}; source ${r.sources[0]}; index days ${r.from} through ${r.to}, inclusive; flag requires at least ${r.minDays} distinct event day(s). EncType: ${r.domain==='NDC'?'not applicable':r.encTypes.join(', ')}. Codes: ${r.codes}. Each covariate is calculated after eligibility and does not change selection.`):['No code-based covariates selected.']),
    'OUTPUTS',
    `${d.stopAfter==='DELIVER'?'At final delivery, export':'If resumed through final delivery, export'} one row per selected PatID with index provenance, recorded Birth_Date and Sex, calculated age_at_index, and selected covariates. Include ATTRITION, DEFINITION, RULES, CODE_SETS, INPUT_MANIFEST, COVARIATE_SPECS, DIAGNOSTICS, COUNTS, MISSINGNESS, EXTRACT_COUNTS, and a 200-row COHORT_PREVIEW without PatID. ${d.outputs.length?`Requested extracts are ${d.outputs.join(', ')}. Clinical extracts include all records from index minus ${d.extractBefore} through index plus ${d.extractAfter} days, inclusive, regardless of event code lists or encounter-type filters. Enrollment extracts include overlapping valid intervals with their original endpoints and coverage flags. Demographic and Death extracts include all records for selected people, including deaths outside the clinical extraction window. Death metadata remains as supplied. Annual extracts remain separate CUT_<table>_<year> files to preserve source attributes. Pooled extracts are CUT_DEM, CUT_DEA, or CUT_ENR as selected.`:'No source extracts requested.'}`,
    'ATTRITION',usesOr(tree)?'Report counts after index, demographics, enrollment when required, and the combined condition tree. Overlapping branches are evaluated together.':'Report counts after index, demographics, enrollment when required, and criteria in numbered order.',
    'ANNOTATIONS',...Object.entries(d.graph.notes).filter(([,note])=>note.trim()).map(([key,note])=>`${/^r\d+$/.test(key)?`Criterion ${Number(key.slice(1))+1}`:key}\n${note}`),
    'FILENAME TEMPLATES',...Object.entries(d.mapping).map(([t,value])=>`${t} = ${value||'[mapping required]'}`),
    'REQUIRED INPUT FILES',...files,
    'STATUS',`This is the configured selection protocol through ${d.stopAfter}. Counts and study results require a validated SAS run. Every required file and field is checked before selection. Missing yearly files stop the run. Existing output datasets are protected. All requested observation windows must fit within the configured delivery years.`
  ].join('\n\n')+'\n';
}
