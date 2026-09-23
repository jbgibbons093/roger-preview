import { isCdm } from './cdm.js?v=a55109c8b4fb';
import { treeFor, groupsIn, logicText, moveCondition } from './logic.js?v=a55109c8b4fb';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WIDTH=210, HEIGHT=166;
let selected='index', zoom=0.85, expanded=false;

function graphModel(d,catalog){
  const tree=treeFor(d), nodes=[],edges=[];
  const add=(id,title,kind,body,x,y)=>nodes.push({id,title,kind,body,...(d.graph.positions[id]||{x,y})});
  add('population','Source population','stage',isCdm(d)?`Mini-Sentinel CDM · ${d.yearStart}–${d.yearEnd}`:`${catalog.families[d.family]} · 2023 · Set ${d.edition}`,30,30);
  add('index','Index event','event',`${d.indexOrder==='LAST'?'Last':'First'} ${catalog.domains[d.index.domain].label}\n${d.index.codes||'Choose index codes'}\n${d.start} to ${d.end}`,270,30);
  add('demographics','Demographics','stage',`${isCdm(d)?'Age at index':'Reported age'} ${d.ageMin}–${d.ageMax}\n${d.sex==='ALL'?'All recorded sex values':['1','M'].includes(d.sex)?'Male':['2','F'].includes(d.sex)?'Female':d.sex}\nApplied after index selection`,510,30);
  add('enrollment','Observation','stage',d.enrollment?`${d.baseline} days before · ${d.followup} days after\nMaximum gap ${d.gap} days\n${isCdm(d)?(d.rx?'Medical + drug coverage required':'Medical coverage required'):(d.rx?'Pharmacy capture required':'Continuous enrollment required')}`:'Enrollment optional',510,250);
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
  add('output','Selected population','stage',`One row per person\n${d.covariates?.length?`${d.covariates.length} baseline covariate${d.covariates.length===1?'':'s'}\n`:''}${d.outputs.length?d.outputs.join(', ')+' extracts':'Cohort and audit tables'}\nCounts available after SAS execution`,30,250);
  edges.push(['population','index'],['index','demographics'],['demographics','enrollment'],['enrollment',tree.id],[tree.id,'output']);
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
export function renderTree(d,catalog){
  const model=graphModel(d,catalog);
  if(!model.nodes.some(n=>n.id===selected))selected='index';
  return `<section class="tree-workspace panel ${expanded?'expanded':''}"><div class="tree-toolbar"><div><h2>Cohort design canvas</h2><p class="hint">Drag a card’s header to arrange it. Drag its Link handle onto an AND/OR group to change its parent.</p></div><div class="tree-actions"><button class="button small" data-tree="add-rule">+ Condition</button><button class="button small" data-tree="add-and">+ AND group</button><button class="button small" data-tree="add-or">+ OR group</button><button class="button small" data-action="export-protocol">Download protocol</button><button class="button small" data-tree="expand">${expanded?'Exit expanded view':'Expand canvas'}</button></div></div>
    <div class="tree-layout"><div><div class="tree-canvas-tools"><button class="button small" data-tree="arrange">Auto-arrange</button><label for="tree-zoom">Zoom</label><select id="tree-zoom">${[0.4,0.55,0.7,0.85,1].map(value=>`<option value="${value}" ${zoom===value?'selected':''}>${Math.round(value*100)}%</option>`).join('')}</select><span class="hint">Arrows show sequence and logical requirements.</span></div><div class="tree-viewport"><div class="tree-size" style="width:${model.width*zoom}px;height:${model.height*zoom}px"><div class="tree-world" style="width:${model.width}px;height:${model.height}px;transform:scale(${zoom})"><svg class="tree-links" width="${model.width}" height="${model.height}" aria-hidden="true"><defs><marker id="tree-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#749b99" stroke="none"/></marker></defs><g>${edgePaths(model)}</g><path id="tree-link-preview" hidden/></svg>${model.nodes.map(n=>`<article class="tree-node ${n.kind} ${n.id===selected?'active':''}" data-node="${n.id}" data-kind="${n.kind}" style="left:${n.x}px;top:${n.y}px"><button class="tree-node-header" data-drag="${n.id}" aria-label="Move ${esc(n.title)}. Arrow keys move this card.">${esc(n.title)}<span aria-hidden="true">⠿</span></button><button class="tree-node-body" data-select-node="${n.id}"><span>${esc(n.body)}</span><small class="tree-note">${esc(d.graph.notes[n.id]||'Click to edit or add a note')}</small></button>${n.kind==='group'?`<button class="tree-port" data-target="${n.id}" aria-label="Connect selected condition to ${esc(n.title)}">Connect here</button>`:''}${/^r\d+$/.test(n.id)||n.kind==='group'&&n.id!==model.tree.id?`<button class="tree-link-handle" data-link="${n.id}" aria-label="Link ${esc(n.title)} to a group">Link ↗</button>`:''}</article>`).join('')}</div></div></div></div><aside id="tree-inspector" class="tree-inspector"></aside></div><div class="tree-expression"><strong>Selection expression</strong><p>${esc(logicText(model.tree))}</p><p class="hint">Every leaf refers to the same person and selected index date. Exclusions pass when the event-day threshold is not reached. Moving a card changes its layout. Reconnecting it changes the selection logic.</p></div></section>`;
}

export function bindTree(container,d,catalog,{changed,refresh,editEvent,editStage,addRule,removeRule,notify}){
  const model=graphModel(d,catalog);
  const $=selector=>container.querySelector(selector);
  let linking=null,drag=null;
  function inspector(){
    const node=model.nodes.find(n=>n.id===selected),group=groupsIn(treeFor(d)).find(g=>g.id===selected);
    const isRule=/^r\d+$/.test(selected),parent=groupsIn(treeFor(d)).find(g=>g.children.some(child=>typeof child==='number'?`r${child}`===selected:child.id===selected));
    $('#tree-inspector').innerHTML=`<p class="eyebrow">SELECTED CARD</p><h3>${esc(node.title)}</h3><p class="hint">${esc(node.body).replaceAll('\n','<br>')}</p>${group?`<label for="tree-operator">Combine children</label><select id="tree-operator"><option value="AND" ${group.op==='AND'?'selected':''}>AND · every condition</option><option value="OR" ${group.op==='OR'?'selected':''}>OR · any condition</option></select>`:`<button class="button full-button" data-tree="edit">Edit ${isRule||selected==='index'?'condition':'settings'}</button>`}
      ${parent?`<label for="tree-parent">Connected to</label><select id="tree-parent">${groupsIn(treeFor(d)).filter(g=>g.id!==selected).map(g=>`<option value="${g.id}" ${g.id===parent.id?'selected':''}>${g.id===model.tree.id?'Eligibility tree':'Group '+g.id.slice(1)} · ${g.op}</option>`).join('')}</select><p class="hint">Changing the parent reconnects this branch.</p>`:''}
      <label for="tree-note">Design note</label><textarea id="tree-note" maxlength="4000" rows="6" placeholder="Rationale, assumptions, or reporting notes">${esc(d.graph.notes[selected]||'')}</textarea><p class="hint">Notes appear in the study population protocol. Notes do not change selection logic.</p>
      ${isRule||parent&&group?'<button class="button danger full-button" data-tree="remove">Remove card</button>':''}<p id="tree-message" class="hint" role="status"></p>`;
  }
  function select(key){selected=key;container.querySelectorAll('.tree-node').forEach(node=>node.classList.toggle('active',node.dataset.node===key));inspector();}
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
    const key=e.target.closest('[data-select-node]')?.dataset.selectNode||e.target.closest('[data-drag]')?.dataset.drag;
    if(key)select(key);
    const link=e.target.closest('[data-link]');if(link){linking=link.dataset.link;select(linking);$('#tree-message').textContent='Choose Connect here on the destination group.';}
    const target=e.target.closest('[data-target]');if(target){if(linking)connect(linking,target.dataset.target);else notify('Choose Link on a condition first, or use its Connected to menu.');}
    const action=e.target.closest('[data-tree]')?.dataset.tree;
    if(action==='edit'){if(selected==='index'||/^r\d+$/.test(selected))editEvent(selected==='index'?-1:Number(selected.slice(1)));else editStage(selected);}
    if(action==='expand'){expanded=!expanded;refresh();}
    if(action==='arrange'){d.graph.positions={};changed();refresh();}
    if(action==='add-rule'){const target=groupsIn(treeFor(d)).find(g=>g.id===selected)?.id||model.tree.id;addRule(target);}
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
  });
  container.addEventListener('input',e=>{if(e.target.id==='tree-note'){d.graph.notes[selected]=e.target.value;$(`[data-node="${selected}"] .tree-note`).textContent=e.target.value||'Click to edit or add a note';changed();}});
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
  inspector();
}
