import { treeFor, logicText, logicIssues, usesOr } from './logic.js';

export const schemaId = 'mini-sentinel-cdm-3.0-v1';
export const TABLES = ['DEM','DEA','ENR','ENC','DIA','PRO','DIS'];
export const DOMAINS = { DX:['DIA'], DX9:['DIA'], PCS:['PRO'], PX9:['PRO'], CPT:['PRO'], HCPCS:['PRO'], DRG:['ENC'], NDC:['DIS'] };
export const ENC_TYPES = { AV:'Ambulatory', ED:'Emergency department', IP:'Acute inpatient', IS:'Non-acute institutional', OA:'Other ambulatory' };
export const catalog = {
  id:schemaId, families:{CDM:'Mini-Sentinel CDM'}, dictionaryVersion:'3.0',
  tables:{
    DEM:{label:'Demographic',pattern:'Demographic_{start}_{end}',date:'Birth_Date',page:9,fields:'PatID Birth_Date Sex',types:'C N C',extract:'All selected people'},
    DEA:{label:'Death',pattern:'Death_{start}_{end}',date:'DeathDt',page:18,fields:'PatID DeathDt DtImpute Source Confidence',types:'C N C C C',extract:'All recorded deaths for selected people'},
    ENR:{label:'Enrollment',pattern:'Enrollment_abd_{start}_{end}_rollup',date:'Enr_Start / Enr_End',page:8,fields:'PatID Enr_Start Enr_End MedCov DrugCov',types:'C N N C C',extract:'Intervals overlapping the cut window'},
    ENC:{label:'Encounter',pattern:'Encounter_{year}',date:'ADate',page:11,fields:'PatID EncounterID ADate EncType DRG DRG_Type',types:'C C N C C C',annual:true,extract:'Selected by encounter/admission date'},
    DIA:{label:'Diagnosis',pattern:'Diagnosis_{year}',date:'ADate',page:14,fields:'PatID EncounterID ADate EncType DX DX_CodeType',types:'C C N C C C',annual:true,extract:'Selected by encounter/admission date'},
    PRO:{label:'Procedure',pattern:'Procedure_{year}',date:'ADate',page:16,fields:'PatID EncounterID ADate EncType PX PX_CodeType',types:'C C N C C C',annual:true,extract:'Selected by encounter/admission date'},
    DIS:{label:'Dispensing',pattern:'Dispensing_{year}',date:'RxDate',page:10,fields:'PatID RxDate NDC',types:'C N C',annual:true,extract:'Selected by dispensing date'}
  },
  domains:{
    DX:{label:'Diagnosis · ICD-10-CM',matching:"DX_CodeType='10'"},
    DX9:{label:'Diagnosis · ICD-9-CM',matching:"DX_CodeType='09'"},
    PCS:{label:'Procedure · ICD-10-PCS',matching:"PX_CodeType='10' and a seven-character PCS value"},
    PX9:{label:'Procedure · ICD-9-CM',matching:"PX_CodeType='09'"},
    CPT:{label:'Procedure · CPT',matching:"PX_CodeType in ('C2','C3','C4')"},
    HCPCS:{label:'Procedure · HCPCS Level II',matching:"PX_CodeType='HC'"},
    DRG:{label:'Encounter group · MS-DRG',matching:"DRG_Type='2'"},
    NDC:{label:'Dispensing · NDC',matching:'Exact 11-digit NDC from Dispensing'}
  }
};
export const isCdm = d => d?.schemaId === schemaId;
export function freshDefinition(){
  return {schemaId,name:'Untitled cohort',family:'CDM',edition:'3.0',yearStart:2013,yearEnd:2023,
    start:'2023-04-01',end:'2023-12-31',ageMin:18,ageMax:64,sex:'ALL',
    enrollment:true,baseline:90,followup:0,gap:0,rx:false,
    index:{domain:'DX',sources:['DIA'],codes:'',encTypes:Object.keys(ENC_TYPES)},rules:[],
    extractBefore:90,extractAfter:0,outputs:['DEM','DIA','DIS','ENR'],
    mapping:Object.fromEntries(TABLES.map(t=>[t,'MS.'+catalog.tables[t].pattern])),inputPath:'',outputPath:'',
    indexOrder:'FIRST',logic:null,graph:{positions:{},notes:{}}};
}
export function expandMapping(d,t){
  const years=catalog.tables[t].annual?Array.from({length:d.yearEnd-d.yearStart+1},(_,i)=>d.yearStart+i):[0];
  if(years.length>100)throw new Error('Use at most 100 delivery years.');
  return years.map(year=>({table:t,year,dataset:d.mapping[t].replaceAll('{start}',d.yearStart).replaceAll('{end}',d.yearEnd).replaceAll('{year}',year)}));
}
export function requiredTables(d){return TABLES.filter(t=>t==='DEM'||t==='ENR'&&d.enrollment||d.outputs.includes(t)||[d.index,...d.rules].some(r=>r.sources.includes(t)));}
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validate(d,parseCodes){
  const errors=logicIssues(treeFor(d),d.rules.length);
  if(!d.name.trim()||d.name.length>120||/[\x00-\x1f]/.test(d.name))errors.push('Enter a cohort name of 1–120 characters.');
  const yearsValid=integer(d.yearStart,1900,2100)&&integer(d.yearEnd,d.yearStart,2100)&&d.yearEnd-d.yearStart<100;
  if(!yearsValid)errors.push('Enter ordered delivery years from 1900 through 2100, spanning at most 100 years.');
  if(!date(d.start)||!date(d.end)||d.start>d.end)errors.push('Enter a valid, ordered index date range.');
  if(!integer(d.ageMin,0,120)||!integer(d.ageMax,d.ageMin,120))errors.push('Age at index must use ordered whole numbers from 0 through 120.');
  for(const key of ['baseline','followup','gap','extractBefore','extractAfter'])if(!integer(d[key],0,3650))errors.push(`${key} must be a whole number from 0 through 3650.`);
  if(d.rx&&!d.enrollment)errors.push('Enable enrollment to require drug coverage.');
  [d.index,...d.rules].forEach((r,i)=>{
    const label=i?`Criterion ${i}`:'Index event';
    if(r.sources.length!==1)errors.push(`${label} requires its CDM source table.`);
    if(r.domain!=='NDC'&&!r.encTypes.length)errors.push(`${label} requires at least one encounter type.`);
    try{const codes=parseCodes(r.codes,r.domain);if(!codes.length||codes.length>500)errors.push(`${label} needs 1–500 codes.`);}catch(e){errors.push(`${label}. ${e.message}`);}
    if(i&&(!integer(r.from,-3650,3650)||!integer(r.to,r.from,3650)||!integer(r.minDays,1,r.to-r.from+1)))errors.push(`${label} needs ordered days from -3650 through 3650 and a feasible distinct-day threshold.`);
  });
  for(const key of ['inputPath','outputPath'])if(/[\x00-\x1f]/.test(d[key])||d[key].length>250)errors.push('Library paths must be single lines of at most 250 characters.');
  if(yearsValid){
    for(const t of TABLES){
      if(!d.mapping[t])continue;
      if(catalog.tables[t].annual&&!d.mapping[t].includes('{year}'))errors.push(`${t} needs a {year} token for its annual files.`);
      for(const row of expandMapping(d,t)){
        if(!/^[A-Za-z_][A-Za-z0-9_]{0,7}\.[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(row.dataset)||/^WORK\._RG_/i.test(row.dataset)){errors.push(`Check ${t}. Each expanded name must be LIBREF.TABLE with a member name of at most 32 characters. WORK._RG_ is reserved.`);break;}
      }
    }
    if(date(d.start)&&date(d.end)){
      const timedOutputs=d.outputs.some(t=>!['DEM','DEA'].includes(t));
      const before=Math.max(d.enrollment?d.baseline:0,timedOutputs?d.extractBefore:0,...d.rules.map(r=>-r.from),0);
      const after=Math.max(d.enrollment?d.followup:0,timedOutputs?d.extractAfter:0,...d.rules.map(r=>r.to),0);
      if(Date.parse(d.start)-before*86400000<Date.parse(`${d.yearStart}-01-01`)||Date.parse(d.end)+after*86400000>Date.parse(`${d.yearEnd}-12-31`))errors.push('Index dates and all requested observation windows must fit within the delivery years.');
    }
  }
  return errors;
}
const q=s=>`'${String(s).replaceAll("'","''")}'`;
export function compile(d,engine,parseCodes){
  if(!engine.includes('%macro roger_cdm_cut;'))throw new Error('The CDM SAS engine could not be loaded.');
  const tables=requiredTables(d),files=tables.flatMap(t=>expandMapping(d,t));
  const rules=[{...d.index,mode:'INDEX',minDays:1,from:0,to:0},...d.rules];
  const tree=treeFor(d);
  const parameters={age_min:d.ageMin,age_max:d.ageMax,sex:d.sex,enrollment:+d.enrollment,baseline:d.baseline,followup:d.followup,gap:d.gap,rx:+d.rx,extract_before:d.extractBefore,extract_after:d.extractAfter,outputs:d.outputs.join(' '),outlib:d.outputPath?'RGCUT':'WORK',index_order:d.indexOrder,advanced_logic:+usesOr(tree)};
  return `/* ROGER Mini-Sentinel CDM v3.0. SAS 9.4.
   Filename conventions supplied by the institution. Delivery years ${d.yearStart}-${d.yearEnd}.
   Confirm the delivery range and mappings before execution.
   Preflight requires the documented CDM fields, including the enrollment rollup.
   Patient identifiers remain character values. Death never changes enrollment.
   This program has not been executed by the browser. WORK._RG_ is reserved.
*/
options errorabend;
${d.inputPath?`libname MS ${q(d.inputPath)} access=readonly;`:'/* Assign the input librefs in this SAS session before running. */'}
${d.outputPath?`libname RGCUT ${q(d.outputPath)};`:'/* Outputs use WORK. Start a fresh SAS session for each run. */'}
${Object.entries(parameters).map(([k,v])=>`%let ${k}=${v};`).join('\n')}
%let index_start=%sysfunc(inputn(${d.start.replaceAll('-','')},yymmdd8.));
%let index_end=%sysfunc(inputn(${d.end.replaceAll('-','')},yymmdd8.));
%let data_start='01JAN${d.yearStart}'d;
%let data_end='31DEC${d.yearEnd}'d;
${TABLES.map(t=>`%let files_${t}=${tables.includes(t)?expandMapping(d,t).map(r=>r.dataset).join(' '):''};\n%let years_${t}=${tables.includes(t)?expandMapping(d,t).map(r=>r.year).join(' '):''};`).join('\n')}

data work._rg_definition;
  length name $120 schema_id $40 logic_json $12000 input_path output_path $250;
  name=${q(d.name)}; schema_id=${q(schemaId)};
  year_start=${d.yearStart}; year_end=${d.yearEnd};
  logic_json=${q(JSON.stringify(tree))};
  input_path=${q(d.inputPath)}; output_path=${q(d.outputPath)};
  index_start=&index_start; index_end=&index_end;
  created_at=datetime(); format created_at datetime20. index_start index_end yymmdd10.;
${Object.entries(parameters).map(([k,v])=>`  ${k}=${typeof v==='number'?v:q(v)};`).join('\n')}
run;
data work._rg_rules;
  length rule_id min_days lower_day upper_day 8 mode $7 domain $5 sources $3 enc_types $14;
  infile datalines4 dlm='|' dsd truncover;
  input rule_id mode :$7. domain :$5. sources :$3. min_days lower_day upper_day enc_types :$14.;
datalines4;
${rules.map((r,i)=>`${i+1}|${r.mode}|${r.domain}|${r.sources[0]}|${r.minDays}|${r.from}|${r.to}|${r.encTypes.join(' ')}`).join('\n')}
;;;;
run;
data work._rg_codes;
  length rule_id 8 code $18 match_type $6;
  infile datalines4 dlm='|' dsd truncover;
  input rule_id code :$18. match_type :$6.;
datalines4;
${rules.flatMap((r,i)=>parseCodes(r.codes,r.domain).map(c=>`${i+1}|${c.code}|${c.match}`)).join('\n')}
;;;;
run;
data work._rg_manifest;
  length source $3 dataset $41 file_year 8;
  infile datalines4 dlm='|' dsd truncover;
  input source :$3. dataset :$41. file_year;
datalines4;
${files.map(r=>`${r.table}|${r.dataset}|${r.year||'.'}`).join('\n')}
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

%macro rg_check_inputs;
  %global patid_length encounterid_length;
  %let patid_length=1;
  %let encounterid_length=1;
${tables.map(t=>!d.mapping[t]?`  %put ERROR: Supply the ${t} table mapping and regenerate this program.;\n  %abort cancel;`:expandMapping(d,t).map(r=>`  %rg_require(${r.dataset},${catalog.tables[t].fields},${catalog.tables[t].types},${+d.outputs.includes(t)});`).join('\n')).join('\n')}
%mend;
%roger_cdm_cut;
`;
}
