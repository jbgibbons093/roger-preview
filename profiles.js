export const PROFILE_KEY='roger.desktop.profiles.v1';
export const DEFAULT_LINK_SCRIPT='C:\\Program Files\\SASHome\\SASFoundation\\9.4\\connect\\saslink\\tcpunix.scr';

export function createProfile(id,name='New profile',sasExecutable=''){
  return {id,name,sasExecutable,serverUser:'',outputParent:'',host:'',port:12600,script:DEFAULT_LINK_SCRIPT,resultsFolder:'',includeCohort:false};
}

export function normalizeProfile(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('A connection profile is malformed.');
  const base=createProfile(value.id,value.name);
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(base.id||''))throw new Error('A connection profile has an invalid ID.');
  if(typeof base.name!=='string'||!base.name.trim()||base.name.length>60||/[\x00-\x1f]/.test(base.name))throw new Error('Name the connection profile using 1–60 characters.');
  for(const key of ['sasExecutable','serverUser','outputParent','host','script','resultsFolder']){
    if(value[key]!==undefined){
      if(typeof value[key]!=='string'||value[key].length>1000||/[\x00-\x1f]/.test(value[key]))throw new Error(`The ${key} profile field is invalid.`);
      base[key]=value[key];
    }
  }
  if(value.port!==undefined){
    const port=Number(value.port);
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error('The SAS/CONNECT port must be 1–65535.');
    base.port=port;
  }
  base.includeCohort=value.includeCohort===true;
  return base;
}

export function readProfileStore(value){
  if(!value||!Array.isArray(value.profiles)||!value.profiles.length||value.profiles.length>20)throw new Error('The saved profile list is invalid.');
  const profiles=value.profiles.map(normalizeProfile);
  const ids=new Set(profiles.map(profile=>profile.id));
  if(ids.size!==profiles.length||!ids.has(value.activeId))throw new Error('The saved active profile is invalid.');
  return {profiles,activeId:value.activeId};
}

export function profileFromSettings(profile,desktopSettings,connectSettings){
  return normalizeProfile({...profile,...desktopSettings,...connectSettings});
}
