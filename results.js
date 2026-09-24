// Browser-local inspection of CSV files exported from SAS. Nothing is uploaded or persisted.
import { parseRunFolder } from './paths.js?v=9ddc8a65f727';
export function parseCsv(source,{maxRows=200000}={}){
  if(typeof source!=='string')throw new Error('Expected CSV text.');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(c==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;continue;}
    if(c==='"'&&cell===''){quoted=true;continue;}
    if(c===','){row.push(cell);cell='';continue;}
    if(c==='\n'||c==='\r'){
      if(c==='\r'&&source[i+1]==='\n')i++;
      row.push(cell);cell='';
      if(row.some(value=>value!==''))rows.push(row);
      if(rows.length>maxRows+1)throw new Error(`CSV exceeds ${maxRows.toLocaleString()} rows. Export a smaller preview for the browser; SAS diagnostics cover the full cohort.`);
      row=[];continue;
    }
    cell+=c;
  }
  if(quoted)throw new Error('CSV ends inside a quoted value.');
  row.push(cell);if(row.some(value=>value!==''))rows.push(row);
  if(!rows.length)throw new Error('CSV is empty.');
  const columns=rows.shift().map((value,i)=>i===0?value.replace(/^\uFEFF/,'').trim():value.trim());
  if(!columns.length||columns.some(value=>!value)||new Set(columns.map(value=>value.toLowerCase())).size!==columns.length)throw new Error('CSV needs unique, nonblank column names.');
  if(rows.some(r=>r.length!==columns.length))throw new Error('CSV row has a different number of columns than the header.');
  return {columns,rows};
}

export function previewRows(table,{search='',sortColumn='',descending=false,page=1,pageSize=50}={}){
  const term=search.toLocaleLowerCase();
  const matches=term?table.rows.filter(row=>row.some(cell=>cell.toLocaleLowerCase().includes(term))):table.rows.slice();
  const index=table.columns.indexOf(sortColumn);
  if(index>=0)matches.sort((a,b)=>{
    const av=a[index],bv=b[index],an=Number(av),bn=Number(bv);
    const comparison=av!==''&&bv!==''&&Number.isFinite(an)&&Number.isFinite(bn)?an-bn:av.localeCompare(bv,undefined,{numeric:true,sensitivity:'base'});
    return descending?-comparison:comparison;
  });
  const pages=Math.max(1,Math.ceil(matches.length/pageSize));
  const current=Math.min(Math.max(1,page),pages);
  return {rows:matches.slice((current-1)*pageSize,current*pageSize),total:matches.length,page:current,pages};
}

export function quickCounts(table,column,split='',{search='',limit=100}={}){
  const a=table.columns.indexOf(column),b=split?table.columns.indexOf(split):-1;
  if(a<0||split&&b<0)throw new Error('Choose columns from the imported table.');
  const term=search.toLocaleLowerCase(),counts=new Map();let total=0;
  for(const row of table.rows){
    if(term&&!row.some(cell=>cell.toLocaleLowerCase().includes(term)))continue;
    total++;
    const x=row[a]||'(missing)',y=b<0?'':row[b]||'(missing)',key=JSON.stringify([x,y]);
    counts.set(key,(counts.get(key)||0)+1);
  }
  const values=[...counts].map(([key,count])=>{const [value,group]=JSON.parse(key);return {value,group,count,percent:total?count/total*100:0};});
  values.sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value)||a.group.localeCompare(b.group));
  return {total,distinct:values.length,rows:values.slice(0,limit),truncated:values.length>limit};
}

export function missingness(table,{search=''}={}){
  const term=search.toLocaleLowerCase(),rows=term?table.rows.filter(row=>row.some(cell=>cell.toLocaleLowerCase().includes(term))):table.rows;
  return table.columns.map((column,index)=>{
    const missing=rows.reduce((n,row)=>n+(row[index]===''||row[index]==='.'?1:0),0);
    return {column,missing,total:rows.length,percent:rows.length?missing/rows.length*100:0};
  });
}

export function compileQuickCount({dataset,column,split='',outputPath,host,port,script}){
  if(!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(dataset)||!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(column)||split&&!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(split))throw new Error('SAS table and columns need valid SAS names.');
  if(dataset.toLowerCase()==='cohort_preview'&&[column,split].some(name=>name.toLowerCase()==='preview_row'))throw new Error('preview_row exists only in the 200-row preview. Choose a cohort variable for the full-data count.');
  const serverDataset=dataset.toLowerCase()==='cohort_preview'?'cohort':dataset;
  parseRunFolder(outputPath);
  if(!/^(?=.{1,253}$)[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(host)||!Number.isInteger(Number(port))||Number(port)<1||Number(port)>65535||!(/^[A-Za-z]:\\[^\r\n;]*\.scr$/i.test(script)))throw new Error('Complete the local SAS/CONNECT settings in the cohort builder.');
  const q=s=>`'${s.replaceAll("'","''")}'`;
  return `/* ROGER quick count. Reads completed run outputs only; writes no server files. */\n%let mynode=${host} ${Number(port)};\noptions comamid=tcp;\nfilename rlink ${q(script)};\nsignon mynode.sasspawn;\nrsubmit;\nlibname RGOUT ${q(outputPath)} access=readonly;\nproc freq data=RGOUT.${serverDataset} order=freq;\n  tables ${column}${split?`*${split}`:''} / missing;\nrun;\nlibname RGOUT clear;\nendrsubmit;\nsignoff mynode.sasspawn nocscript;\n`;
}
