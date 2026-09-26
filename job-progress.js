const stageNames={connection:'Server sign-on',preflight:'CDM preflight',index:'Index selection',eligibility:'Eligibility',covariates:'Covariates',outcomes:'Outcomes',delivery:'Final delivery'};

export function elapsedLabel(milliseconds){
  const seconds=Math.max(0,Math.floor(milliseconds/1000));
  const hours=Math.floor(seconds/3600),minutes=Math.floor((seconds%3600)/60),remaining=seconds%60;
  return hours?`${hours}h ${String(minutes).padStart(2,'0')}m`:minutes?`${minutes}m ${String(remaining).padStart(2,'0')}s`:`${remaining}s`;
}

export function lastReportedStage(log){
  const lines=String(log||'').match(/^ROGER_PROGRESS stage=(connection|preflight|index|eligibility|covariates|outcomes|delivery) event=(start|complete)\s*$/gm);
  if(!lines?.length)return '';
  const [,stage,event]=/^ROGER_PROGRESS stage=(\w+) event=(\w+)/.exec(lines.at(-1));
  return `${stageNames[stage]} ${event==='complete'?'completed':'started'}`;
}

export function jobProgressText(job,now=Date.now()){
  if(!job)return '';
  const started=Date.parse(job.startedAt||''),finished=Date.parse(job.finishedAt||'');
  const elapsed=Number.isFinite(started)?elapsedLabel((Number.isFinite(finished)?finished:now)-started):'unknown';
  const stage=lastReportedStage(job.log);
  if(job.status!=='running')return `${job.status==='completed'?'Finished':'Stopped'} after ${elapsed}${stage?` · Last report: ${stage}`:''}.`;
  const last=Date.parse(job.lastOutputAt||'');
  if(!Number.isFinite(last))return `Running ${elapsed}${stage?` · Last report: ${stage}`:''} · Waiting for the first SAS log output. Sign-on may need your credentials.`;
  const quiet=Math.max(0,now-last);
  return `Running ${elapsed}${stage?` · Last report: ${stage}`:''} · Last SAS output ${elapsedLabel(quiet)} ago.${quiet>=30_000?' SAS/CONNECT may buffer messages during a remote step.':''}`;
}
