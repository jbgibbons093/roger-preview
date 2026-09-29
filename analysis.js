import { parseRunFolder } from './paths.js?v=68c34411cda1';
import { outcomeFollowupComplete } from './cdm.js?v=68c34411cda1';

export const ANALYSIS_METHODS=[
  {id:'TABLE1',label:'Table 1',input:'cohort',description:'Treated versus control characteristics and SMD before and after adjustment.'},
  {id:'PSM',label:'Propensity score matching',input:'cohort',description:'One-to-one greedy matching on logit propensity; ATT population.'},
  {id:'IPTW',label:'Inverse probability weighting',input:'cohort',description:'Stabilized ATE weights, balance, and a weighted outcome model.'},
  {id:'TTE',label:'Target trial emulation',input:'cohort',description:'Point-treatment active-comparator new-user trial with fixed-horizon outcome.'},
  {id:'MSM',label:'Marginal structural model',input:'panel',description:'Time-varying treatment and censoring weights with pooled-logistic outcome model.'},
  {id:'CCW',label:'Clone–censor–weight',input:'panel',description:'Two grace-period initiation strategies, artificial censoring, and IPCW.'},
  {id:'DID',label:'Difference-in-differences',input:'panel',description:'Two-period treated-versus-control interaction with clustered uncertainty.'},
  {id:'ITS',label:'Interrupted time series',input:'series',description:'Segmented level and slope change with AR(1) errors (SAS/ETS).'},
  {id:'EVENT',label:'Event study',input:'panel',description:'Single adoption wave versus never-treated controls; period -1 reference.'}
];
const sasName=/^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const methodInfo=method=>ANALYSIS_METHODS.find(item=>item.id===method);
const integer=(value,min,max)=>Number.isInteger(Number(value))&&Number(value)>=min&&Number(value)<=max;
const between=(value,min,max)=>Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;

export function freshAnalysis(definition,method='TABLE1'){
  return {
    method,sourcePath:methodInfo(method)?.input==='cohort'?definition.outputPath||'':'',outputPath:'',
    dataset:methodInfo(method)?.input==='cohort'?'cohort':methodInfo(method)?.input==='series'?'series':'analysis_panel',
    id:'PatID',treatment:methodInfo(method)?.input==='cohort'?'treatment_flag':'treatment',
    outcome:methodInfo(method)?.input==='cohort'&&definition.outcomes?.length?`out_${definition.outcomes[0].key}`:'outcome',
    time:'period',censor:'censored',
    covariates:methodInfo(method)?.input==='cohort'?[
      ...(definition.predictors?.age===false?[]:['age_at_index']),
      ...(definition.predictors?.sex===false?[]:['sex_female']),
      ...(definition.covariates||[]).filter(item=>item.predictor).map(item=>`cov_${item.key}`)
    ]:[],
    adjustment:'NONE',caliper:0.2,psFloor:0.01,weightCap:20,
    grace:30,intervention:1,eventPre:5,eventPost:5
  };
}

export function validateAnalysis(spec,{serverUser='',definition=null,completedCohortPath=''}={}){
  const issues=[],method=methodInfo(spec?.method);
  if(!method)return ['Choose an analysis method.'];
  let source,output;
  try{source=parseRunFolder(spec.sourcePath);}catch(error){issues.push(`Input: ${error.message}`);}
  try{output=parseRunFolder(spec.outputPath);}catch(error){issues.push(`Output: ${error.message}`);}
  if(source&&source.user!==serverUser)issues.push('Input must be under the selected investigator’s server home.');
  if(output&&output.user!==serverUser)issues.push('Analysis output must be under the selected investigator’s server home.');
  if(source&&output&&(source.path===output.path||source.path.startsWith(`${output.path}/`)||output.path.startsWith(`${source.path}/`)))issues.push('Use a fresh analysis folder separate from the input folder.');
  if(method.input==='cohort'&&(!completedCohortPath||spec.sourcePath!==completedCohortPath))issues.push('Open the completed final cohort run used for this analysis.');
  if(method.input==='cohort'&&String(spec.dataset).toLowerCase()!=='cohort')issues.push('Baseline analyses read the completed COHORT dataset.');
  if(method.input==='cohort'&&(spec.id!=='PatID'||spec.treatment!=='treatment_flag'))issues.push('Baseline analyses use PatID and treatment_flag from the completed cohort.');
  if(!sasName.test(spec.dataset||''))issues.push('Enter a SAS-safe source dataset name.');
  if(method.input!=='cohort'&&String(spec.dataset).toLowerCase()==='cohort')issues.push('Longitudinal methods require a prepared panel or series, not COHORT.');
  // Every value interpolated into SAS is checked, including fields unused by this method.
  const fields=['id','treatment','outcome','time','censor'];
  for(const field of fields)if(!sasName.test(spec[field]||''))issues.push(`${field} must be a SAS-safe variable name.`);
  const used=method.input==='cohort'?['id','treatment',...(spec.method==='TABLE1'?[]:['outcome'])]:method.input==='series'?['time','outcome']:['id','treatment','outcome','time',...(['MSM','CCW'].includes(spec.method)?['censor']:[])];
  if(new Set(used.map(field=>String(spec[field]).toLowerCase())).size!==used.length)issues.push('ID, treatment, outcome, time, and censor variables used by this method must be distinct.');
  if(!Array.isArray(spec.covariates)||spec.covariates.length>20||spec.covariates.some(value=>!sasName.test(value))||new Set(spec.covariates.map(value=>value.toLowerCase())).size!==spec.covariates.length)issues.push('Choose at most 20 distinct SAS-safe covariates.');
  if(['TABLE1','PSM','IPTW','TTE','MSM','CCW'].includes(spec.method)&&!spec.covariates?.length)issues.push('Select at least one covariate.');
  if(spec.covariates?.some(value=>fields.some(field=>String(spec[field]).toLowerCase()===value.toLowerCase())))issues.push('Covariates cannot duplicate the ID, treatment, outcome, time, or censor variable.');
  if(!['NONE','PSM','IPTW'].includes(spec.adjustment))issues.push('Choose no adjustment, matching, or IPTW for Table 1.');
  if(!between(spec.caliper,0.01,2))issues.push('Matching caliper must be 0.01–2 logit-PS standard deviations.');
  if(!between(spec.psFloor,0.0001,0.1)||!between(spec.weightCap,1,1000))issues.push('Choose a probability floor of 0.0001–0.1 and a weight cap of 1–1000.');
  if(!integer(spec.grace,1,3650))issues.push('Grace period must be 1–3650 intervals.');
  if(!integer(spec.intervention,1,100000))issues.push('Enter a positive intervention period.');
  if(!integer(spec.eventPre,2,12)||!integer(spec.eventPost,1,12))issues.push('Use 2–12 pre-periods and 1–12 post-periods.');
  if(method.input==='cohort'&&definition){
    if(!definition.comparison)issues.push('Define treatment and control groups in the cohort.');
    const outcome=definition.outcomes?.find(item=>`out_${item.key}`===spec.outcome);
    if(!outcome&&spec.method!=='TABLE1')issues.push('Select an outcome built by the completed cohort.');
    if(outcome&&(!integer(outcome.from,1,3650)||!integer(outcome.to,1,3650)||Number(outcome.to)<Number(outcome.from)))issues.push('The selected outcome needs a valid post-index horizon.');
    else if(spec.method==='TTE'&&!outcomeFollowupComplete(definition,outcome))issues.push('Target trial emulation needs assured follow-up through the selected outcome horizon.');
    const allowed=new Set(['age_at_index','sex_female',...(definition.covariates||[]).filter(item=>item.predictor).map(item=>`cov_${item.key}`)]);
    if(spec.covariates?.some(item=>!allowed.has(item)))issues.push('Use only selected pre-index predictors from the completed cohort.');
  }
  return issues;
}

export function compileAnalysis(spec,{engine,definition,serverUser,completedCohortPath,connection}){
  const issues=validateAnalysis(spec,{definition,serverUser,completedCohortPath});
  if(issues.length)throw new Error(issues.join('\n'));
  const host=String(connection?.host||'').trim(),port=Number(connection?.port),script=String(connection?.script||'').trim();
  if(!/^(?=.{1,253}$)[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(host)||!integer(port,1,65535)||!/^[A-Za-z]:\\[^\r\n;'"%&]*\.scr$/i.test(script))throw new Error('Complete the SAS/CONNECT host, port, and local link script.');
  if(typeof engine!=='string'||!engine.includes('%macro rg_analyze;'))throw new Error('The ROGER analysis engine did not load.');
  const output=parseRunFolder(spec.outputPath);
  const outcome=definition?.outcomes?.find(item=>`out_${item.key}`===spec.outcome);
  return `/* ROGER ${spec.method}. Input is read-only; output is a fresh folder in the investigator home. */
%let mynode=${host} ${port};
options comamid=tcp;
filename rlink ${q(script)};
signon mynode.sasspawn;
rsubmit;
options errorabend;
libname RGIN ${q(spec.sourcePath)} access=readonly;
data _null_;
  length folder $1024;
  if fileexist(${q(spec.outputPath)}) then do;
    put 'ERROR: Analysis output folder already exists. Choose a fresh name.'; abort cancel;
  end;
  folder=dcreate(${q(output.name)},${q(output.home)});
  if missing(folder) then do;
    put 'ERROR: Cannot create the analysis folder under your approved home.'; abort cancel;
  end;
run;
libname RGANA ${q(spec.outputPath)};
%let rg_method=${spec.method};
%let rg_dataset=${spec.dataset};
%let rg_id=${spec.id};
%let rg_treatment=${spec.treatment};
%let rg_outcome=${spec.outcome};
%let rg_time=${spec.time};
%let rg_censor=${spec.censor};
%let rg_covariates=${spec.covariates.join(' ')};
%let rg_adjustment=${spec.adjustment};
%let rg_caliper=${Number(spec.caliper)};
%let rg_ps_floor=${Number(spec.psFloor)};
%let rg_weight_cap=${Number(spec.weightCap)};
%let rg_grace=${Number(spec.grace)};
%let rg_intervention=${Number(spec.intervention)};
%let rg_event_pre=${Number(spec.eventPre)};
%let rg_event_post=${Number(spec.eventPost)};
%let rg_outcome_from=${outcome?.from||0};
%let rg_outcome_to=${outcome?.to||0};
${engine}
%rg_analyze;
libname RGANA clear;
libname RGIN clear;
endrsubmit;
signoff mynode.sasspawn nocscript;
`;
}
