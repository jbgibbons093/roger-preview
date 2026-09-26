import { DOMAINS as CDM_DOMAINS, ENC_TYPES } from './cdm.js?v=2a7380fd6912';
import { treeFor, groupsIn, logicText, moveCondition } from './logic.js?v=2a7380fd6912';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WIDTH=210, HEIGHT=166;
let selected='index', zoom=0.85, expanded=false;

export function issueNode(issue){
  const text=String(issue);
  const rule=text.match(/^Criterion (\d+)\b/i);
  if(rule)return `r${Number(rule[1])-1}`;
  if(/\bcovariate\b|baseline covariates/i.test(text))return 'covariates';
  if(/afterIndex|afterEligibility|stopAfter/i.test(text))return 'output';
  if(/\bage\b|\bsex\b|demographic/i.test(text))return 'demographics';
  if(/\bindex\b|date range/i.test(text))return 'index';
  if(/enrollment|coverage|pharmacy|\bbaseline\b|\bfollowup\b|\bgap\b/i.test(text))return 'enrollment';
  if(/output|extract|mapping|\btable\b|library|folder|checkpoint|afterIndex|afterEligibility|stopAfter/i.test(text))return 'output';
  if(/logic|group|condition|criterion/i.test(text))return 'g0';
  return 'population';
}

function graphModel(d,catalog){
  const tree=treeFor(d), nodes=[],edges=[];
  const add=(id,title,kind,body,x,y)=>nodes.push({id,title,kind,body,...(d.graph.positions[id]||{x,y})});
  add('population','Source population','stage',`Mini-Sentinel CDM · ${d.yearStart}–${d.yearEnd}`,30,30);
  add('index','Index event','event',`${d.indexOrder==='LAST'?'Last':'First'} ${catalog.domains[d.index.domain].label}\n${d.index.codes||'Choose index codes'}\n${d.start} to ${d.end}`,270,30);
  add('demographics','Demographics','stage',`Age at index ${d.ageMin}–${d.ageMax}\n${d.sex==='ALL'?'All recorded sex values':d.sex==='M'?'Male':d.sex==='F'?'Female':d.sex}\nApplied after index selection`,510,30);
  add('enrollment','Observation','stage',d.enrollment?`${d.baseline} days before · ${d.followup} days after\nMaximum gap ${d.gap} days\n${d.rx?'Medical + drug coverage required':'Medical coverage required'}`:'Enrollment optional',510,250);
  let leaf=0;
  function branch(group,depth){
    const start=leaf;
    for(const child of group.children){
      if(typeof child==='number'){
        const r=d.rules[child];
        add(`r${child}`,`Criterion ${child+1}`,r.mode==='EXCLUDE'?'exclude':'event',`${r.mode==='EXCLUDE'?'Exclude':'Require'} · ${catalog.domains[r.domain].label}\n${r.codes||'Choose codes'}\n≥${r.minDays} day(s) · window ${r.from} to ${r.to}`,30+leaf*240,470+depth*220);leaf++;
      }else branch(child,depth+1);
      edges.push([group.id,typeof child==='number'?`r${child}`:child.id]);
    }
    if(leaf===start)leaf++;
    add(group.id,group.id===tree.id?'Eligibility tree':`Group ${group.id.slice(1)}`,'group',`${group.op==='AND'?'AND · every condition':'OR · any condition'}\n${group.children.length} connected item(s)`,group.id===tree.id?270:30+(start+leaf-1)*120,group.id===tree.id?250:250+depth*220);
  }
  branch(tree,0);
  const finalRow=Math.max(...nodes.map(n=>n.y+HEIGHT))+70;
  add('covariates','Baseline covariates','stage',`${d.covariates.length} code-based feature${d.covariates.length===1?'':'s'}\nFlags and distinct-day counts\nCalculated after eligibility`,30,finalRow);
  add('output','Selected population','stage',`One row per person\n${d.outputs.length?d.outputs.join(', ')+' extracts':'Cohort and audit tables'}\nCounts available after SAS execution`,270,finalRow);
  edges.push(['population','index'],['index','demographics'],['demographics','enrollment'],['enrollment',tree.id]);
  edges.push([tree.id,'covariates'],['covariates','output']);
  return {nodes,edges,tree,width:Math.max(760,...nodes.map(n=>n.x+WIDTH+40)),height:Math.max(680,...nodes.map(n=>n.y+HEIGHT+60))};
}
function edgePaths(model){
  return model.edges.map(([from,to])=>{
    const a=model.nodes.find(n=>n.id===from),b=model.nodes.find(n=>n.id===to);
    const horizontal=Math.abs(a.y-b.y)<60;
    const direction=b.x>=a.x?1:-1;
    const x1=a.x+(horizontal?(direction>0?WIDTH:0):WIDTH/2),y1=a.y+(horizontal?HEIGHT/2:HEIGHT),x2=b.x+(horizontal?(direction>0?0:WIDTH):WIDTH/2),y2=b.y+(horizontal?HEIGHT/2:0);
    const path=horizontal?`M${x1},${y1} C${x1+25*direction},${y1} ${x2-25*direction},${y2} ${x2},${y2}`:`M${x1},${y1} C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}`;
    return `<path d="${path}" marker-end="url(#tree-arrow)"/>`;
  }).join('');
}
export function renderTree(d,catalog,showExport=false,issueCount=0){
  const model=graphModel(d,catalog);
  if(!model.nodes.some(n=>n.id===selected))selected='index';
  return `<section class="tree-workspace panel ${expanded?'expanded':''}"><div class="tree-toolbar"><div><h2>Cohort design canvas</h2><p class="hint">Select a card to edit its criteria here. Drag a header to arrange cards or a Link handle onto a group to change logic.</p><p class="tree-validation" role="status">${issueCount?`Draft · ${issueCount} definition item${issueCount===1?'':'s'} need attention`:'Ready for SAS'}</p></div><div class="tree-actions"><button class="button small" data-tree="add-rule">+ Condition</button><button class="button small" data-tree="add-and">+ AND group</button><button class="button small" data-tree="add-or">+ OR group</button><button class="button small primary" data-action="save-tree">Save cohort</button><button class="button small" data-action="save-tree-as">Save as new</button>${showExport?'<button class="button small" data-action="export-protocol">Download protocol</button>':''}<button class="button small" data-tree="expand">${expanded?'Exit expanded view':'Expand canvas'}</button></div></div>
    <div class="tree-layout"><div><div class="tree-canvas-tools"><button class="button small" data-tree="arrange">Auto-arrange</button><label for="tree-zoom">Zoom</label><select id="tree-zoom">${[0.4,0.55,0.7,0.85,1].map(value=>`<option value="${value}" ${zoom===value?'selected':''}>${Math.round(value*100)}%</option>`).join('')}</select><span class="hint">Arrows show sequence and logical requirements.</span></div><div class="tree-viewport"><div class="tree-size" style="width:${model.width*zoom}px;height:${model.height*zoom}px"><div class="tree-world" style="width:${model.width}px;height:${model.height}px;transform:scale(${zoom})"><svg class="tree-links" width="${model.width}" height="${model.height}" aria-hidden="true"><defs><marker id="tree-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#749b99" stroke="none"/></marker></defs><g>${edgePaths(model)}</g><path id="tree-link-preview" hidden/></svg>${model.nodes.map(n=>`<article class="tree-node ${n.kind} ${n.id===selected?'active':''}" data-node="${n.id}" data-kind="${n.kind}" style="left:${n.x}px;top:${n.y}px"><button class="tree-node-header" data-drag="${n.id}" aria-label="Move ${esc(n.title)}. Arrow keys move this card.">${esc(n.title)}<span aria-hidden="true">⠿</span></button><button class="tree-node-body" data-select-node="${n.id}"><span>${esc(n.body)}</span><small class="tree-note">${esc(d.graph.notes[n.id]||'Click to edit or add a note')}</small></button>${n.kind==='group'?`<button class="tree-port" data-target="${n.id}" aria-label="Connect selected condition to ${esc(n.title)}">Connect here</button>`:''}${/^r\d+$/.test(n.id)||n.kind==='group'&&n.id!==model.tree.id?`<button class="tree-link-handle" data-link="${n.id}" aria-label="Link ${esc(n.title)} to a group">Link ↗</button>`:''}</article>`).join('')}</div></div></div></div><aside id="tree-inspector" class="tree-inspector"></aside></div><div class="tree-expression"><strong>Selection expression</strong><p>${esc(logicText(model.tree))}</p><p class="hint">Every leaf refers to the same person and selected index date. Exclusions pass when the event-day threshold is not reached. Moving a card changes its layout. Reconnecting it changes the selection logic.</p></div><div class="tree-issue-list" aria-live="polite"></div></section>`;
}

export function bindTree(container,d,catalog,{changed,refresh,addRule,removeRule,browseCodes,notify,domains,issues}){
  const model=graphModel(d,catalog);
  const $=selector=>container.querySelector(selector);
  let linking=null,drag=null;
  const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
  const field=(label,modelName,key,value,type='text',extra='',index='')=>`<div class="tree-field"><label for="tree-${modelName}-${index}-${key}">${esc(label)}</label><input id="tree-${modelName}-${index}-${key}" data-tree-model="${modelName}" data-tree-index="${index}" data-tree-key="${key}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  const selectField=(label,modelName,key,value,choices,index='')=>`<div class="tree-field"><label for="tree-${modelName}-${index}-${key}">${esc(label)}</label><select id="tree-${modelName}-${index}-${key}" data-tree-model="${modelName}" data-tree-index="${index}" data-tree-key="${key}">${choices.map(([v,l])=>option(v,l,value)).join('')}</select></div>`;
  const codeChoices=Object.keys(domains).map(key=>[key,catalog.domains[key].label]);
  const sourceChecks=(rule,index)=>`<div class="tree-field"><span class="field-label">Search these tables</span><div class="tree-checks">${domains[rule.domain].map(source=>`<label><input type="checkbox" data-tree-source="${index}" value="${source}" ${rule.sources.includes(source)?'checked':''}>${esc(catalog.tables[source].label)}</label>`).join('')}</div></div>`;
  const encounterChecks=(rule,index)=>rule.domain!=='NDC'?`<div class="tree-field"><span class="field-label">Encounter types</span><div class="tree-checks">${Object.entries(ENC_TYPES).map(([value,label])=>`<label><input type="checkbox" data-tree-enc="${index}" value="${value}" ${rule.encTypes.includes(value)?'checked':''}>${value} · ${esc(label)}</label>`).join('')}</div></div>`:'';
  const ruleFields=(rule,index)=>`<div class="tree-form"><div class="tree-field-grid">${selectField('Code system','rule','domain',rule.domain,codeChoices,index)}${index===-1?selectField('Index date','cohort','indexOrder',d.indexOrder,[['FIRST','First matching event'],['LAST','Last matching event']]):selectField('Eligibility','rule','mode',rule.mode,[['INCLUDE','Include matching people'],['EXCLUDE','Exclude matching people']],index)}</div>${index===-1?`<div class="tree-field-grid">${field('Index dates from','cohort','start',d.start,'date')}${field('Through','cohort','end',d.end,'date')}</div>`:`<div class="tree-field-grid three">${field('From day','rule','from',rule.from,'number','step="1"',index)}${field('Through day','rule','to',rule.to,'number','step="1"',index)}${field('Minimum days','rule','minDays',rule.minDays,'number','min="1" step="1"',index)}</div>`}<div class="tree-field"><label for="tree-rule-${index}-codes">Codes</label><textarea id="tree-rule-${index}-codes" data-tree-model="rule" data-tree-index="${index}" data-tree-key="codes" rows="3" placeholder="Codes separated by commas; * for a prefix">${esc(rule.codes)}</textarea><button type="button" class="button small" data-tree-browse="${index}">Browse code catalog</button></div>${sourceChecks(rule,index)}${encounterChecks(rule,index)}</div>`;
  const covariateFields=()=>`<div class="tree-form"><p class="hint">These flags describe selected people and do not change eligibility.</p>${d.covariates.map((cov,index)=>`<details class="tree-covariate" open><summary>${esc(cov.label||cov.key||`Covariate ${index+1}`)}</summary><div class="tree-field-grid">${field('Variable key','cov','key',cov.key,'text','maxlength="20"',index)}${field('Display label','cov','label',cov.label,'text','maxlength="80"',index)}</div>${selectField('Code system','cov','domain',cov.domain,Object.keys(CDM_DOMAINS).map(key=>[key,catalog.domains[key].label]),index)}<div class="tree-field"><label for="tree-cov-${index}-codes">Codes</label><textarea id="tree-cov-${index}-codes" data-tree-model="cov" data-tree-index="${index}" data-tree-key="codes" rows="2">${esc(cov.codes)}</textarea><button type="button" class="button small" data-tree-cov-browse="${index}">Browse code catalog</button></div><div class="tree-field-grid three">${field('From day','cov','from',cov.from,'number','step="1"',index)}${field('Through day','cov','to',cov.to,'number','step="1"',index)}${field('Minimum days','cov','minDays',cov.minDays,'number','min="1" step="1"',index)}</div>${cov.domain==='NDC'?'':`<div class="tree-field"><span class="field-label">Encounter types</span><div class="tree-checks">${Object.entries(ENC_TYPES).map(([value,label])=>`<label><input type="checkbox" data-tree-cov-enc="${index}" value="${value}" ${cov.encTypes.includes(value)?'checked':''}>${value} · ${esc(label)}</label>`).join('')}</div></div>`}<button type="button" class="button small danger" data-tree-cov-remove="${index}">Remove covariate</button></details>`).join('')||'<p class="hint">No baseline covariates selected.</p>'}<button type="button" class="button full-button" data-tree="add-covariate" ${d.covariates.length>=20?'disabled':''}>+ Add covariate</button></div>`;
  const outputFields=()=>`<div class="tree-form"><div class="tree-field"><span class="field-label">Extract these tables</span><div class="tree-checks">${Object.keys(catalog.tables).map(table=>`<label><input type="checkbox" data-tree-output="${table}" ${d.outputs.includes(table)?'checked':''}>${esc(catalog.tables[table].label)}</label>`).join('')}</div></div><div class="tree-field-grid">${field('Extract days before index','cohort','extractBefore',d.extractBefore,'number','min="0" step="1"')}${field('Days after index','cohort','extractAfter',d.extractAfter,'number','min="0" step="1"')}</div><details class="tree-advanced"><summary>SAS checkpoints and add-on code</summary>${selectField('Run through','cohort','stopAfter',d.stopAfter,[['INDEX','Index selection'],['ELIGIBILITY','Eligibility'],['DELIVER','Final data cut']])}<div class="tree-field"><label for="tree-after-index">SAS after index</label><textarea id="tree-after-index" data-tree-model="cohort" data-tree-key="afterIndexSas" rows="3">${esc(d.afterIndexSas)}</textarea></div><div class="tree-field"><label for="tree-after-eligibility">SAS after eligibility</label><textarea id="tree-after-eligibility" data-tree-model="cohort" data-tree-key="afterEligibilitySas" rows="3">${esc(d.afterEligibilitySas)}</textarea></div></details><details class="tree-advanced"><summary>SAS table mappings</summary>${field('Input folder (optional)','cohort','inputPath',d.inputPath)}${Object.keys(catalog.tables).map(table=>field(`${table} · ${catalog.tables[table].label}`,'map',table,d.mapping[table])).join('')}</details></div>`;
  function inspector(){
    const node=model.nodes.find(n=>n.id===selected),group=groupsIn(treeFor(d)).find(g=>g.id===selected);
    const isRule=/^r\d+$/.test(selected),parent=groupsIn(treeFor(d)).find(g=>g.children.some(child=>typeof child==='number'?`r${child}`===selected:child.id===selected));
    const content=selected==='population'?`<div class="tree-form">${field('Cohort name','cohort','name',d.name)}<div class="tree-field-grid">${field('Delivery start year','cohort','yearStart',d.yearStart,'number','min="1900" max="2100"')}${field('End year','cohort','yearEnd',d.yearEnd,'number','min="1900" max="2100"')}</div></div>`:selected==='index'?ruleFields(d.index,-1):isRule?ruleFields(d.rules[Number(selected.slice(1))],Number(selected.slice(1))):selected==='demographics'?`<div class="tree-form"><div class="tree-field-grid">${field('Minimum age','cohort','ageMin',d.ageMin,'number','min="0" step="1"')}${field('Maximum age','cohort','ageMax',d.ageMax,'number','min="0" step="1"')}</div>${selectField('Recorded sex','cohort','sex',d.sex,[['ALL','Any'],['M','Male'],['F','Female'],['A','Ambiguous'],['U','Unknown']])}</div>`:selected==='enrollment'?`<div class="tree-form"><label class="tree-toggle"><input type="checkbox" data-tree-model="cohort" data-tree-key="enrollment" ${d.enrollment?'checked':''}>Require medical coverage</label><div class="tree-field-grid three">${field('Days before','cohort','baseline',d.baseline,'number','min="0" step="1"')}${field('Days after','cohort','followup',d.followup,'number','min="0" step="1"')}${field('Maximum gap','cohort','gap',d.gap,'number','min="0" step="1"')}</div><label class="tree-toggle"><input type="checkbox" data-tree-model="cohort" data-tree-key="rx" ${d.rx?'checked':''} ${!d.enrollment?'disabled':''}>Require drug coverage</label></div>`:selected==='covariates'?covariateFields():selected==='output'?outputFields():'';
    $('#tree-inspector').innerHTML=`<p class="eyebrow">EDIT SELECTED CARD</p><h3>${esc(node.title)}</h3><p class="hint">${esc(node.body).replaceAll('\n','<br>')}</p>${content}${group?`<label for="tree-operator">Combine children</label><select id="tree-operator"><option value="AND" ${group.op==='AND'?'selected':''}>AND · every condition</option><option value="OR" ${group.op==='OR'?'selected':''}>OR · any condition</option></select>`:''}
      ${parent?`<label for="tree-parent">Connected to</label><select id="tree-parent">${groupsIn(treeFor(d)).filter(g=>g.id!==selected).map(g=>`<option value="${g.id}" ${g.id===parent.id?'selected':''}>${g.id===model.tree.id?'Eligibility tree':'Group '+g.id.slice(1)} · ${g.op}</option>`).join('')}</select><p class="hint">Changing the parent reconnects this branch.</p>`:''}
      <label for="tree-note">Design note</label><textarea id="tree-note" maxlength="4000" rows="6" placeholder="Rationale, assumptions, or reporting notes">${esc(d.graph.notes[selected]||'')}</textarea><p class="hint">Notes appear in the study population protocol. Notes do not change selection logic.</p>
      ${isRule||parent&&group?'<button class="button danger full-button" data-tree="remove">Remove card</button>':''}<p id="tree-message" class="hint" role="status"></p>`;
  }
  function select(key){selected=key;container.querySelectorAll('.tree-node').forEach(node=>node.classList.toggle('active',node.dataset.node===key));inspector();}
  function renderIssues(found){
    const holder=$('.tree-issue-list');
    if(holder)holder.innerHTML=found.length?`<strong>Fix these items before running SAS</strong><div>${found.map(issue=>`<button type="button" data-issue-node="${issueNode(issue)}">${esc(issue)} <span aria-hidden="true">→</span></button>`).join('')}</div>`:'';
  }
  function redraw(){
    const viewport=$('.tree-viewport'),position={left:viewport.scrollLeft,top:viewport.scrollTop};
    refresh();
    const next=container.isConnected?container:document.querySelector('.tree-workspace');
    const nextViewport=next?.querySelector('.tree-viewport');
    if(nextViewport){nextViewport.scrollLeft=position.left;nextViewport.scrollTop=position.top;}
  }
  function reflect(){
    const current=graphModel(d,catalog).nodes.find(node=>node.id===selected);
    const card=$(`[data-node="${selected}"]`);
    if(current&&card){card.querySelector('.tree-node-header').firstChild.textContent=current.title;card.querySelector('.tree-node-body>span').textContent=current.body;card.classList.toggle('exclude',current.kind==='exclude');card.classList.toggle('event',current.kind==='event');}
    const found=issues?.()||[];
    $('.tree-validation').textContent=found.length?`Draft · ${found.length} definition item${found.length===1?'':'s'} need attention`:'Ready for SAS';
    renderIssues(found);
  }
  function editValue(el){
    const kind=el.dataset.treeModel,key=el.dataset.treeKey,index=Number(el.dataset.treeIndex);
    const target=kind==='rule'?(index===-1?d.index:d.rules[index]):kind==='cov'?d.covariates[index]:kind==='map'?d.mapping:d;
    if(!target||!key)return;
    target[key]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?NaN:Number(el.value)):el.value;
    if(kind==='cohort'&&!d.enrollment)d.rx=false;
    changed();reflect();
  }
  function connect(key,target){try{const tree=moveCondition(treeFor(d),key,target);d.logic=tree;changed();refresh();}catch(e){notify(e.message);inspector();}}
  function updatePosition(node,x,y){
    node.x=Math.max(0,Math.min(20000,x));node.y=Math.max(0,Math.min(20000,y));
    const card=$(`[data-node="${node.id}"]`);card.style.left=node.x+'px';card.style.top=node.y+'px';
    $('.tree-links g').innerHTML=edgePaths(model);
    const width=Math.max(model.width,node.x+WIDTH+40),height=Math.max(model.height,node.y+HEIGHT+60);
    $('.tree-world').style.width=width+'px';$('.tree-world').style.height=height+'px';
    $('.tree-size').style.width=width*zoom+'px';$('.tree-size').style.height=height*zoom+'px';
    $('.tree-links').setAttribute('width',width);$('.tree-links').setAttribute('height',height);
  }
  container.addEventListener('click',e=>{
    const issue=e.target.closest('[data-issue-node]');
    if(issue){select(issue.dataset.issueNode);$(`[data-node="${issue.dataset.issueNode}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});$('#tree-inspector')?.scrollIntoView({block:'nearest'});return;}
    const key=e.target.closest('[data-select-node]')?.dataset.selectNode||e.target.closest('[data-drag]')?.dataset.drag;
    if(key)select(key);
    const link=e.target.closest('[data-link]');if(link){linking=link.dataset.link;select(linking);$('#tree-message').textContent='Choose Connect here on the destination group.';}
    const target=e.target.closest('[data-target]');if(target){if(linking)connect(linking,target.dataset.target);else notify('Choose Link on a condition first, or use its Connected to menu.');}
    const action=e.target.closest('[data-tree]')?.dataset.tree;
    const browse=e.target.closest('[data-tree-browse]');if(browse){browseCodes('rule',Number(browse.dataset.treeBrowse));return;}
    const covBrowse=e.target.closest('[data-tree-cov-browse]');if(covBrowse){browseCodes('cov',Number(covBrowse.dataset.treeCovBrowse));return;}
    const covRemove=e.target.closest('[data-tree-cov-remove]');if(covRemove){d.covariates.splice(Number(covRemove.dataset.treeCovRemove),1);changed();redraw();return;}
    if(action==='expand'){expanded=!expanded;redraw();}
    if(action==='arrange'){d.graph.positions={};changed();redraw();}
    if(action==='add-covariate'){
      if(d.covariates.length>=20){notify('A cohort can contain up to 20 covariates.');return;}
      const n=d.covariates.length+1;
      d.covariates.push({key:`feature_${n}`,label:`Feature ${n}`,domain:'DX',sources:['DIA'],codes:'',encTypes:Object.keys(ENC_TYPES),from:-365,to:-1,minDays:1});
      changed();redraw();return;
    }
    if(action==='add-rule'){const target=groupsIn(treeFor(d)).find(g=>g.id===selected)?.id||model.tree.id;const index=addRule(target);if(index!==null){selected=`r${index}`;redraw();}}
    if(action==='add-and'||action==='add-or'){
      d.logic=structuredClone(treeFor(d));const groups=groupsIn(d.logic);
      if(groups.length>=20){notify('Use at most 20 groups.');return;}
      const id='g'+(Math.max(...groups.map(g=>Number(g.id.slice(1))))+1);
      (groups.find(g=>g.id===selected)||d.logic).children.push({id,op:action==='add-or'?'OR':'AND',children:[]});selected=id;changed();refresh();
    }
    if(action==='remove'){
      if(/^r\d+$/.test(selected)){removeRule(Number(selected.slice(1)));selected='index';refresh();}
      else{d.logic=structuredClone(treeFor(d));for(const parent of groupsIn(d.logic)){const i=parent.children.findIndex(child=>child?.id===selected);if(i>=0){parent.children.splice(i,1,...parent.children[i].children);break;}}delete d.graph.notes[selected];delete d.graph.positions[selected];selected=d.logic.id;changed();refresh();}
    }
  });
  container.addEventListener('change',e=>{
    if(e.target.id==='tree-parent')connect(selected,e.target.value);
    if(e.target.id==='tree-operator'){d.logic=structuredClone(treeFor(d));groupsIn(d.logic).find(g=>g.id===selected).op=e.target.value;changed();refresh();}
    if(e.target.id==='tree-zoom'){zoom=Number(e.target.value);refresh();}
    const el=e.target;
    if(el.dataset.treeSource!==undefined){const rule=Number(el.dataset.treeSource)===-1?d.index:d.rules[Number(el.dataset.treeSource)];rule.sources=el.checked?[...rule.sources,el.value]:rule.sources.filter(value=>value!==el.value);changed();reflect();return;}
    if(el.dataset.treeEnc!==undefined){const rule=Number(el.dataset.treeEnc)===-1?d.index:d.rules[Number(el.dataset.treeEnc)];rule.encTypes=el.checked?[...rule.encTypes,el.value]:rule.encTypes.filter(value=>value!==el.value);changed();reflect();return;}
    if(el.dataset.treeCovEnc!==undefined){const cov=d.covariates[Number(el.dataset.treeCovEnc)];cov.encTypes=el.checked?[...cov.encTypes,el.value]:cov.encTypes.filter(value=>value!==el.value);changed();reflect();return;}
    if(el.dataset.treeOutput!==undefined){d.outputs=el.checked?[...d.outputs,el.dataset.treeOutput]:d.outputs.filter(value=>value!==el.dataset.treeOutput);changed();reflect();return;}
    if(el.dataset.treeModel){
      if(el.dataset.treeModel==='rule'&&el.dataset.treeKey==='domain'){
        const rule=Number(el.dataset.treeIndex)===-1?d.index:d.rules[Number(el.dataset.treeIndex)];
        rule.sources=domains[rule.domain].slice(0,1);rule.codes='';rule.encTypes=rule.domain==='NDC'?[]:Object.keys(ENC_TYPES);
      }
      if(el.dataset.treeModel==='cov'&&el.dataset.treeKey==='domain'){
        const cov=d.covariates[Number(el.dataset.treeIndex)];cov.sources=CDM_DOMAINS[cov.domain].slice();cov.codes='';cov.encTypes=cov.domain==='NDC'?[]:Object.keys(ENC_TYPES);
      }

      // Text, date, and number fields are already reflected on input. Rebuilding
      // the tree on blur can remove the Save button before its click is delivered.
      if(el.matches('select, input[type="checkbox"]'))redraw();
      else editValue(el);
      return;
    }
  });
  container.addEventListener('input',e=>{
    if(e.target.id==='tree-note'){d.graph.notes[selected]=e.target.value;$(`[data-node="${selected}"] .tree-note`).textContent=e.target.value||'Click to edit or add a note';changed();return;}
    if(e.target.dataset.treeModel)editValue(e.target);
  });
  container.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&expanded){expanded=false;refresh();return;}
    const id=e.target.dataset.drag;if(!id||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();const n=model.nodes.find(n=>n.id===id),step=e.shiftKey?50:10;
    updatePosition(n,n.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),n.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0));d.graph.positions[id]={x:n.x,y:n.y};changed();
  });
  container.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const header=e.target.closest('[data-drag]'),link=e.target.closest('[data-link]');if(!header&&!link)return;
    const id=header?.dataset.drag||link.dataset.link,n=model.nodes.find(n=>n.id===id);
    drag={id,node:n,x:e.clientX,y:e.clientY,startX:n.x,startY:n.y,link:!!link,target:e.target};e.target.setPointerCapture(e.pointerId);select(id);
  });
  container.addEventListener('pointermove',e=>{
    if(!drag)return;
    const dx=(e.clientX-drag.x)/zoom,dy=(e.clientY-drag.y)/zoom;
    if(drag.link){const path=$('#tree-link-preview');path.removeAttribute('hidden');path.setAttribute('d',`M${drag.startX+WIDTH/2},${drag.startY+HEIGHT} l${dx},${dy}`);}
    else updatePosition(drag.node,drag.startX+dx,drag.startY+dy);
  });
  container.addEventListener('pointerup',e=>{
    if(!drag)return;
    const ended=drag;drag=null;
    ended.target.releasePointerCapture(e.pointerId);$('#tree-link-preview').setAttribute('hidden','');
    if(ended.link){const group=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-kind="group"]');if(group&&group.dataset.node!==ended.id)connect(ended.id,group.dataset.node);}
    else{d.graph.positions[ended.id]={x:ended.node.x,y:ended.node.y};changed();}
  });
  container.addEventListener('pointercancel',()=>{if(drag&&!drag.link)updatePosition(drag.node,drag.startX,drag.startY);drag=null;$('#tree-link-preview').setAttribute('hidden','');});
  inspector();renderIssues(issues?.()||[]);
}
