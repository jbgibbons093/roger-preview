// A completed run is one new directory under an investigator's server home.
const homePrefix='/storage/storage1/PHShome';
const segment=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const userSegment=/^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export function parseOutputParent(value,user){
  if(!userSegment.test(user||''))throw new Error('Enter your server username before choosing an output location.');
  const parts=String(value||'').trim().split('/');
  const base=`${homePrefix}/${user}`;
  const path=parts.join('/');
  if(path!==base&&!path.startsWith(`${base}/`))throw new Error('Choose an output parent inside your own approved server home.');
  const projects=path.slice(base.length).split('/').filter(Boolean);
  if(projects.length>3||projects.some(part=>!segment.test(part))||path!==`${base}${projects.length?`/${projects.join('/')}`:''}`)throw new Error('Use a server output parent with at most three simple folder names under your home.');
  return path;
}

export function parseRunFolder(value){
  const path=String(value||'').trim();
  if(/\/Medicare_CDM(?:\/|$)/i.test(path))throw new Error('The CDM source is read-only. Choose a new run under your approved PHShome user directory.');
  const match=path.match(/^\/storage\/storage1\/PHShome\/([A-Za-z][A-Za-z0-9_-]{0,31})\/(.+)$/);
  if(!match)throw new Error('Choose one new run directory under your approved /storage/storage1/PHShome/<user> folder.');
  const segments=match[2].split('/');
  if(segments.length>4||segments.some(part=>!segment.test(part)))throw new Error('The run folder must use a new, simple name under your approved server home.');
  const home=path.slice(0,path.lastIndexOf('/'));
  parseOutputParent(home,match[1]);
  return {user:match[1],home,name:segments.at(-1),path};
}
