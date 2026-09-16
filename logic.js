export const defaultLogic = count => ({id:'g0',op:'AND',children:Array.from({length:count},(_,i)=>i)});
export const treeFor = d => d.logic || defaultLogic(d.rules.length);
export function groupsIn(tree) { return [tree,...tree.children.filter(child=>typeof child==='object').flatMap(groupsIn)]; }
export function logicText(tree, leaf = index => `Criterion ${index + 1}`) {
  return tree.children.length ? '(' + tree.children.map(child=>typeof child==='number'?leaf(child):logicText(child,leaf)).join(` ${tree.op} `) + ')' : 'No additional criteria';
}
export function logicIssues(tree, count, allowEmpty = false) {
  const leaves=[],ids=new Set(),errors=[];
  function visit(node,depth){
    if(typeof node==='number'){if(!Number.isInteger(node)||node<0||node>=count)errors.push('A condition link references a missing criterion.');leaves.push(node);return;}
    if(depth>8||!node||!/^g\d{1,3}$/.test(node.id)||ids.has(node.id)||!['AND','OR'].includes(node.op)||!Array.isArray(node.children)||node.children.length>40){errors.push('The condition tree contains an invalid group, duplicate group, or excessive nesting.');return;}
    ids.add(node.id);
    if(!allowEmpty&&!node.children.length&&(depth>0||count>0))errors.push('Every condition group needs at least one connected criterion.');
    node.children.forEach(child=>visit(child,depth+1));
  }
  visit(tree,0);
  if(ids.size>20)errors.push('Use at most 20 condition groups.');
  if(leaves.length!==count||new Set(leaves).size!==count)errors.push('Each criterion must appear exactly once in the condition tree.');
  return errors;
}
export const usesOr = tree => groupsIn(tree).some(group=>group.op==='OR');
export function moveCondition(tree, key, targetId) {
  const copy=structuredClone(tree);
  if(key===copy.id)throw new Error('The root group stays connected to the cohort.');
  let moving;
  for(const group of groupsIn(copy)){
    const index=group.children.findIndex(child=>typeof child==='number'?`r${child}`===key:child.id===key);
    if(index>=0){[moving]=group.children.splice(index,1);break;}
  }
  if(moving===undefined)throw new Error('Select a condition or group to connect.');
  const target=groupsIn(copy).find(group=>group.id===targetId);
  if(!target)throw new Error('A group cannot connect to itself or one of its descendants.');
  target.children.push(moving);
  return copy;
}
export function removeCriterion(d,index){
  const transform=group=>({...group,children:group.children.filter(child=>child!==index).map(child=>typeof child==='number'?(child>index?child-1:child):transform(child))});
  if(d.logic)d.logic=transform(d.logic);
  d.rules.splice(index,1);
  for(const kind of ['notes','positions']){
    const revised={};
    for(const [key,value] of Object.entries(d.graph?.[kind]||{})){
      if(key===`r${index}`)continue;
      const match=/^r(\d+)$/.exec(key);
      revised[match&&Number(match[1])>index?`r${Number(match[1])-1}`:key]=value;
    }
    if(d.graph)d.graph[kind]=revised;
  }
}
