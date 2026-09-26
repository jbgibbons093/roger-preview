import { treeFor, logicText, logicIssues, usesOr } from './logic.js?v=d3c6c8b02db3';
import { parseRunFolder } from './paths.js?v=d3c6c8b02db3';

export const schemaId = 'mini-sentinel-cdm-3.0-v1';
export const TABLES = ['DEM','DEA','ENR','ENC','DIA','PRO','DIS'];
export const DOMAINS = { DX:['DIA'], DX9:['DIA'], PCS:['PRO'], PX9:['PRO'], CPT:['PRO'], HCPCS:['PRO'], DRG:['ENC'], NDC:['DIS'] };
export const ENC_TYPES = { AV:'Ambulatory', ED:'Emergency department', IP:'Acute inpatient', IS:'Non-acute institutional', OA:'Other ambulatory' };
export const catalog = {
  id:schemaId, families:{CDM:'Mini-Sentinel CDM'}, dictionaryVersion:'3.0',
  tables:{
    DEM:{label:'Demographic',pattern:'Demographic_{start}_{end}',date:'Birth_Date',page:9,fields:'PatID Birth_Date Sex',types:'A N C',extract:'All selected people'},
    DEA:{label:'Death',pattern:'Death_{start}_{end}',date:'Death_Date',page:18,fields:'PatID Death_Date',types:'A N',extract:'All recorded deaths for selected people'},
    ENR:{label:'Enrollment',pattern:'Enrollment_abd_{start}_{end}_rollup',date:'Enr_Start / Enr_End',page:8,fields:'PatID Enr_Start Enr_End MedCov DrugCov',types:'A N N C C',extract:'Intervals overlapping the cut window'},
    ENC:{label:'Encounter',pattern:'Encounter{year}',date:'ADate',page:11,fields:'PatID EncounterID ADate EncType DRG DRG_Type',types:'A C N C C C',annual:true,extract:'Selected by encounter/admission date'},
    DIA:{label:'Diagnosis',pattern:'Diagnosis{year}',date:'ADate',page:14,fields:'PatID EncounterID ADate EncType DX DX_CodeType',types:'A C N C C C',annual:true,extract:'Selected by encounter/admission date'},
    PRO:{label:'Procedure',pattern:'Procedure{year}',date:'ADate',page:16,fields:'PatID EncounterID ADate EncType PX PX_CodeType',types:'A C N C C C',annual:true,extract:'Selected by encounter/admission date'},
    DIS:{label:'Dispensing',pattern:'Dispensing{year}',date:'RxDate',page:10,fields:'PatID RxDate NDC',types:'A N C',annual:true,extract:'Selected by dispensing date'}
  },
  domains:{
    DX:{label:'Diagnosis · ICD-10-CM',matching:"DX_CodeType='10'"},
    DX9:{label:'Diagnosis · ICD-9-CM',matching:"DX_CodeType='09'"},
    PCS:{label:'Procedure · ICD-10-PCS',matching:"PX_CodeType='10' and a seven-character PCS value"},
    PX9:{label:'Procedure · ICD-9-CM',matching:"PX_CodeType='09'"},
    CPT:{label:'Procedure · CPT',matching:"PX_CodeType in ('C2','C3','C4')"},
    HCPCS:{label:'Procedure · HCPCS Level II',matching:"PX_CodeType='HC'"},
    DRG:{label:'Encounter group · MS-DRG',matching:"DRG_Type='2'. SAS stops with a data-quality error when queried records have DRG values but none are marked type 2; confirm the grouper version with the data steward."},
    NDC:{label:'Dispensing · NDC',matching:'Exact 11-digit NDC from Dispensing'}
  }
};
export const isCdm = d => d?.schemaId === schemaId;
export function freshDefinition(){
  return {schemaId,name:'Untitled cohort',family:'CDM',edition:'3.0',yearStart:2013,yearEnd:2023,
    start:'2023-04-01',end:'2023-12-31',ageMin:18,ageMax:64,sex:'ALL',
    enrollment:true,baseline:90,followup:0,gap:0,rx:false,
    index:{domain:'DX',sources:['DIA'],codes:'',encTypes:Object.keys(ENC_TYPES)},rules:[],covariates:[],
    extractBefore:90,extractAfter:0,outputs:['DEM','DIA','DIS','ENR'],
    mapping:Object.fromEntries(TABLES.map(t=>[t,'MS.'+catalog.tables[t].pattern])),inputPath:'',outputPath:'',
    indexOrder:'FIRST',stopAfter:'DELIVER',afterIndexSas:'',afterEligibilitySas:'',logic:null,graph:{positions:{},notes:{}}};
}
export function expandMapping(d,t){
  const years=catalog.tables[t].annual?Array.from({length:d.yearEnd-d.yearStart+1},(_,i)=>d.yearStart+i):[0];
  if(years.length>100)throw new Error('Use at most 100 delivery years.');
  return years.map(year=>({table:t,year,dataset:d.mapping[t].replaceAll('{start}',d.yearStart).replaceAll('{end}',d.yearEnd).replaceAll('{year}',year)}));
}
export function requiredTables(d){return TABLES.filter(t=>t==='DEM'||t==='ENR'&&d.enrollment||d.outputs.includes(t)||[d.index,...d.rules,...(d.covariates||[])].some(r=>r.sources.includes(t)));}
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validate(d,parseCodes){
  const errors=logicIssues(treeFor(d),d.rules.length);
  if(!['INDEX','ELIGIBILITY','DELIVER'].includes(d.stopAfter))errors.push('Choose an index, eligibility, or delivery checkpoint.');
  for(const key of ['afterIndexSas','afterEligibilitySas']){
    if(typeof d[key]!=='string'||d[key].length>10000||/[\x00\x1a]/.test(d[key])||/%mend\b|\b(?:rsubmit|endrsubmit)\b/i.test(d[key]))errors.push(`${key} must be SAS code of at most 10,000 characters without a macro or remote-session terminator.`);
  }
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
  if(!Array.isArray(d.covariates)||d.covariates.length>20)errors.push('Choose at most 20 covariates.');
  const seenCovariates=new Set();
  (Array.isArray(d.covariates)?d.covariates:[]).forEach((r,i)=>{
    const label=`Covariate ${i+1}`;
    if(!/^[a-z][a-z0-9_]{0,19}$/.test(r.key||'')||seenCovariates.has(r.key))errors.push(`${label} needs a unique SAS-safe key of 1–20 lowercase letters, digits, or underscores.`);
    seenCovariates.add(r.key);
    if(!r.label?.trim()||r.label.length>80||/[\x00-\x1f|]/.test(r.label))errors.push(`${label} needs a label of 1–80 characters without |.`);
    if(!Object.hasOwn(DOMAINS,r.domain)||r.sources?.length!==1||r.sources[0]!==DOMAINS[r.domain][0])errors.push(`${label} needs one compatible CDM source table.`);
    if(r.domain!=='NDC'&&(!Array.isArray(r.encTypes)||!r.encTypes.length))errors.push(`${label} needs an encounter type.`);
    try{const codes=parseCodes(r.codes,r.domain);if(!codes.length||codes.length>500)errors.push(`${label} needs 1–500 codes.`);}catch(e){errors.push(`${label}. ${e.message}`);}
    if(!integer(r.from,-3650,3650)||!integer(r.to,r.from,3650)||!integer(r.minDays,1,r.to-r.from+1))errors.push(`${label} needs an ordered index-relative day window and feasible distinct-day threshold.`);
  });
  for(const key of ['inputPath','outputPath'])if(/[\x00-\x1f]/.test(d[key])||d[key].length>250)errors.push('Library paths must be single lines of at most 250 characters.');
  if(d.inputPath&&d.outputPath){
    const source=d.inputPath.replaceAll('\\','/').replace(/\/+$/,'').toLowerCase();
    const output=d.outputPath.replaceAll('\\','/').replace(/\/+$/,'').toLowerCase();
    if(output===source||output.startsWith(`${source}/`))errors.push('The output folder must be outside the input folder.');
  }
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
      const before=Math.max(d.enrollment?d.baseline:0,timedOutputs?d.extractBefore:0,...d.rules.map(r=>-r.from),...(d.covariates||[]).map(r=>-r.from),0);
      const after=Math.max(d.enrollment?d.followup:0,timedOutputs?d.extractAfter:0,...d.rules.map(r=>r.to),...(d.covariates||[]).map(r=>r.to),0);
      if(Date.parse(d.start)-before*86400000<Date.parse(`${d.yearStart}-01-01`)||Date.parse(d.end)+after*86400000>Date.parse(`${d.yearEnd}-12-31`))errors.push('Index dates and all requested observation windows must fit within the delivery years.');
    }
  }
  return errors;
}
const q=s=>`'${String(s).replaceAll("'","''")}'`;
export function compile(d,engine,parseCodes){
  if(!engine.includes('%macro roger_cdm_cut;'))throw new Error('The CDM SAS engine could not be loaded.');
  const tables=requiredTables(d),files=tables.flatMap(t=>expandMapping(d,t));
  const rules=[{...d.index,mode:'INDEX',minDays:1,from:0,to:0},...d.rules],covariates=d.covariates||[];
  const tree=treeFor(d);
  const parameters={age_min:d.ageMin,age_max:d.ageMax,sex:d.sex,enrollment:+d.enrollment,baseline:d.baseline,followup:d.followup,gap:d.gap,rx:+d.rx,extract_before:d.extractBefore,extract_after:d.extractAfter,outputs:d.outputs.join(' '),outlib:d.outputPath?'RGCUT':'WORK',index_order:d.indexOrder,advanced_logic:+usesOr(tree),stop_after:d.stopAfter};
  return `/* ROGER Mini-Sentinel CDM v3.0. SAS 9.4.
   Filename conventions supplied by the institution. Delivery years ${d.yearStart}-${d.yearEnd}.
   Confirm the delivery range and mappings before execution.
   Preflight requires the documented CDM fields, including the enrollment rollup.
   Patient identifiers retain the source type. Death never changes enrollment.
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
${[...rules.flatMap((r,i)=>parseCodes(r.codes,r.domain).map(c=>`${i+1}|${c.code}|${c.match}`)),...covariates.flatMap((r,i)=>parseCodes(r.codes,r.domain).map(c=>`${1001+i}|${c.code}|${c.match}`))].join('\n')}
;;;;
run;
data work._rg_covariates;
  length cov_id min_days lower_day upper_day 8 key $20 label $80 domain $5 sources $3 enc_types $14;
  infile datalines4 dlm='|' dsd truncover;
  input cov_id key :$20. label :$80. domain :$5. sources :$3. min_days lower_day upper_day enc_types :$14.;
datalines4;
${covariates.map((r,i)=>`${1001+i}|${r.key}|${r.label}|${r.domain}|${r.sources[0]}|${r.minDays}|${r.from}|${r.to}|${r.encTypes.join(' ')}`).join('\n')}
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

%macro rg_build_covariates;
${covariates.map((r,i)=>`  %rg_covariate(${1001+i},${r.domain},${r.sources[0]},${r.encTypes.join(' ')},${r.from},${r.to},${r.minDays},${r.key});`).join('\n')||'  /* No selected code-based covariates. */'}
%mend;

%macro rg_covariate_counts;
${covariates.map(r=>`  dimension='Covariate: ${r.key}'; value=ifc(cov_${r.key}=1,'Yes','No'); output;`).join('\n')||'  /* No selected covariates. */'}
%mend;
%macro rg_covariate_missing;
${covariates.map(r=>`  variable='cov_${r.key}'; is_missing=missing(cov_${r.key}); output;`).join('\n')||'  /* No selected covariates. */'}
%mend;

${engine}

%macro rg_addon_after_index;
${d.afterIndexSas.trim()||'  /* No index add-on code. */'}
%mend;
%macro rg_addon_after_eligibility;
${d.afterEligibilitySas.trim()||'  /* No eligibility add-on code. */'}
%mend;

%macro rg_check_inputs;
  %global patid_length patid_type encounterid_length;
  %let patid_length=1;
  %let patid_type=;
  %let encounterid_length=1;
${tables.map(t=>!d.mapping[t]?`  %put ERROR: Supply the ${t} table mapping and regenerate this program.;\n  %abort cancel;`:expandMapping(d,t).map(r=>`  %rg_require(${r.dataset},${catalog.tables[t].fields},${catalog.tables[t].types},${+d.outputs.includes(t)});`).join('\n')).join('\n')}
%mend;
%roger_cdm_cut;
`;
}

export function compileConnect(d,engine,parseCodes,settings){
  const issues=validate(d,parseCodes);
  if(issues.length)throw new Error(issues.join('\n'));
  const host=String(settings.host||'').trim();
  const port=Number(settings.port);
  const script=String(settings.script||'').trim();
  if(!/^(?=.{1,253}$)[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(host))throw new Error('Enter the SAS/CONNECT server hostname.');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Enter a valid SAS/CONNECT port.');
  if(!/^[A-Za-z]:\\[^\r\n;]*\.scr$/i.test(script))throw new Error('Enter the local SAS link script path.');
  const output=d.outputPath.trim();
  const outputRun=output?parseRunFolder(output):null;
  const body=compile(d,engine,parseCodes);
  const createOutput=outputRun?`data _null_;
  length folder $1024;
  if fileexist(${q(output)}) then do;
    put 'ERROR: ROGER output directory already exists. Choose a fresh run name.';
    abort cancel;
  end;
  folder=dcreate(${q(outputRun.name)},${q(outputRun.home)});
  if missing(folder) then do;
    put 'ERROR: Could not create the ROGER output directory in the configured home.';
    abort cancel;
  end;
run;
`:'';
  return `/* Run this program in local SAS 9.4. SAS/CONNECT executes the CDM cut remotely. */
%let mynode=${host} ${port};
options comamid=tcp;
filename rlink ${q(script)};
%put ROGER_PROGRESS stage=connection event=start;
signon mynode.sasspawn;
rsubmit;
%put ROGER_PROGRESS stage=connection event=complete;
${createOutput}
${body}
endrsubmit;
signoff mynode.sasspawn nocscript;
`;
}

export function compileResultsExport(d,settings){
  if(d.stopAfter!=='DELIVER')throw new Error('Results are available after Final data cut. Review the checkpoint log, then run a fresh final cut.');
  const output=String(d.outputPath||'').trim();
  parseRunFolder(output);
  const host=String(settings.host||'').trim(),port=Number(settings.port),script=String(settings.script||'').trim();
  if(!/^(?=.{1,253}$)[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(host)||!Number.isInteger(port)||port<1||port>65535||!(/^[A-Za-z]:\\[^\r\n;]*\.scr$/i.test(script)))throw new Error('Complete the local SAS/CONNECT settings.');
  const folder=String(settings.resultsFolder||'').trim().replace(/[\\/]+$/,'');
  if(!/^[A-Za-z]:\\[^\r\n;'"%&]{1,220}$/.test(folder))throw new Error('Enter an existing Windows folder for local CSV results.');
  const tables=['cohort_preview','diagnostics','attrition','counts','missingness','extract_counts','covariate_specs',...(settings.includeCohort?['cohort']:[])];
  const quote=s=>`'${s.replaceAll("'","''")}'`;
  const checks=tables.map(t=>`  if fileexist(${quote(`${folder}\\${t}.csv`)}) then do; put 'ERROR: ${t}.csv already exists. Use an empty results folder.'; abort cancel; end;`).join('\n');
  const workChecks=tables.map(t=>`%if %sysfunc(exist(work.rg_${t})) %then %do; %put ERROR: WORK.RG_${t} already exists. Start a fresh local SAS session.; %abort cancel; %end;`).join('\n');
  const deliveredChecks=tables.map(t=>`%if not %sysfunc(exist(work.rg_${t})) %then %do; %put ERROR: ${t} did not download.; %abort cancel; %end;`).join('\n');
  return `/* Run in a fresh local SAS 9.4 session after the cohort cut. Local CSV files are created only in the selected folder.\n   ROGER never writes into the CDM source or completed server run folder. */\n%macro rg_result_precheck;\n${workChecks}\n%mend;\n%rg_result_precheck;\ndata _null_;\n  if not fileexist(${quote(folder)}) then do; put 'ERROR: Local results folder does not exist.'; abort cancel; end;\n${checks}\nrun;\n%let mynode=${host} ${port};\noptions comamid=tcp;\nfilename rlink ${quote(script)};\nsignon mynode.sasspawn;\nrsubmit;\nlibname RGOUT ${quote(output)} access=readonly;\n${tables.map(t=>`proc download data=RGOUT.${t} out=work.rg_${t}; run;`).join('\n')}\nlibname RGOUT clear;\nendrsubmit;\nsignoff mynode.sasspawn nocscript;\n%macro rg_result_postcheck;\n  %if &syscc > 4 %then %do; %put ERROR: SAS/CONNECT download failed.; %abort cancel; %end;\n${deliveredChecks}\n%mend;\n%rg_result_postcheck;\n${tables.map(t=>`proc export data=work.rg_${t} outfile=${quote(`${folder}\\${t}.csv`)} dbms=csv; run;`).join('\n')}\n`;
}

export function compilePrintPreview(d,settings){
  if(d.stopAfter!=='DELIVER')throw new Error('The 100-row preview is available after Final data cut. Review the checkpoint log, then run a fresh final cut.');
  const output=String(d.outputPath||'').trim();
  parseRunFolder(output);
  const host=String(settings.host||'').trim(),port=Number(settings.port),script=String(settings.script||'').trim();
  if(!/^(?=.{1,253}$)[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(host)||!Number.isInteger(port)||port<1||port>65535||!(/^[A-Za-z]:\\[^\r\n;]*\.scr$/i.test(script)))throw new Error('Complete the local SAS/CONNECT settings.');
  const quote=s=>`'${s.replaceAll("'","''")}'`;
  return `/* ROGER 100-row PROC PRINT preview. Run in a fresh local SAS 9.4 session.
   The completed server cut is read-only. Only its identifier-free COHORT_PREVIEW
   is transferred to local WORK; nothing is saved into the CDM or run folder. */
options errorabend;
%macro rg_preview_precheck;
%if %sysfunc(exist(work.rg_print_preview)) %then %do;
  %put ERROR: WORK.RG_PRINT_PREVIEW already exists. Use a fresh SAS session.;
  %abort cancel;
%end;
%mend;
%rg_preview_precheck;
%let mynode=${host} ${port};
options comamid=tcp;
filename rlink ${quote(script)};
signon mynode.sasspawn;
rsubmit;
libname RGOUT ${quote(output)} access=readonly;
%macro rg_preview_remote_check;
%if not %sysfunc(exist(RGOUT.cohort_preview)) %then %do;
  %put ERROR: COHORT_PREVIEW was not found in the completed run folder.;
  %abort cancel;
%end;
%mend;
%rg_preview_remote_check;
proc download data=RGOUT.cohort_preview out=work.rg_print_preview; run;
libname RGOUT clear;
endrsubmit;
signoff mynode.sasspawn nocscript;
%macro rg_preview_postcheck;
%if not %sysfunc(exist(work.rg_print_preview)) %then %do;
  %put ERROR: The preview did not download.;
  %abort cancel;
%end;
%mend;
%rg_preview_postcheck;
title 'ROGER completed cohort: first 100 rows (identifiers omitted)';
proc print data=work.rg_print_preview(obs=100) noobs; run;
title;
`;
}
