import {runtimeFactoryAssets} from '../../assets/runtime/factory/v1/manifest.js';
import {runtimeFactoryFloor} from '../../assets/runtime/factory/v1/floor.js';
import {factoryExpansionAssets} from '../../assets/source/factory/expansion/v1/manifest.js';
import {factoryDecorationAssets} from '../../assets/runtime/decoration/v1/manifest.js';
import {factoryProducts,factoryLayoutPresets,buildFactoryExpansionLayout} from './workshop-layout.js';
import {WorkshopCamera} from './workshop-camera.js';
import {WorkshopUpgrade} from './workshop-upgrade.js';
import {renderWorkshopGround} from './workshop-ground.js';
import {renderWorkshopLogistics,updateWorkshopLogistics} from './workshop-logistics.js';
import {renderWorkshopBoundary} from './workshop-boundary.js';
import {WorkshopPresentation} from './workshop-presentation.js';
import {WorkshopMotion} from './workshop-motion.js';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),vectors=factoryExpansionAssets.assets;
const definitions=new Map([...runtimeFactoryAssets,...factoryDecorationAssets].map(asset=>[asset.id,asset]));
const levels=new Map(),nodes=new Map(),images=new Map(),overviewLabels=new Map();
const world=$('world'),viewport=$('scene-viewport');
const overlay=document.createElement('div');overlay.className='overview-labels';overlay.setAttribute('aria-label','工坊总览定位');viewport.append(overlay);
const presentation=new WorkshopPresentation(viewport,world);
const motion=new WorkshopMotion(viewport);
let counts=[...factoryLayoutPresets.six],layout,selected,logistics,camera,upgrade,upgradeCameraState,upgradeStartSelectionId,overview=false,courtyardView=false,workshopView=false,viewWidth=0,viewHeight=0;
if(params.get('capture')==='phone')document.body.classList.add('capture-mode');

function loadImage(src){
  if(images.has(src))return images.get(src);
  const promise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`资源未载入：${src.split('/').pop()}`));img.src=src;});
  images.set(src,promise);return promise;
}
function fitSprite(container,asset,width,height){
  const [x0,y0,x1,y1]=asset.bounds||[0,0,...asset.size],scale=Math.min(width/(x1-x0),height/(y1-y0));
  const img=document.createElement('img');img.src=asset.src;img.alt='';img.draggable=false;
  Object.assign(img.style,{position:'absolute',width:`${asset.size[0]*scale}px`,height:`${asset.size[1]*scale}px`,left:`${(width-(x1-x0)*scale)/2-x0*scale}px`,top:`${(height-(y1-y0)*scale)/2-y0*scale}px`});container.replaceChildren(img);
}
function caption(text,x,y,width,className){
  const label=document.createElement('div');label.className=className;label.textContent=text;
  Object.assign(label.style,{left:`${x}px`,top:`${y}px`,width:`${width}px`});world.append(label);return label;
}
function mount(assetId,id,name,cx,foot,width,type='shared',data={}){
  const asset=definitions.get(assetId),[x0,y0,x1,y1]=asset.bounds,scale=width/(x1-x0),height=(y1-y0)*scale;
  const left=cx-width/2,top=foot-height*(type==='line'?.88:.9),node={id,name,type,asset,left,top,width,height,foot,...data};
  const button=document.createElement('button');button.type='button';button.className=`equipment-item${type==='cache'?' small':''}`;button.dataset.deviceId=id;button.setAttribute('aria-pressed','false');
  Object.assign(button.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${Math.max(44,height)}px`,zIndex:String(100+Math.round(foot))});
  const ring=document.createElement('span');ring.className='selection';button.append(ring);
  const sprite=document.createElement('div');sprite.className='sprite';sprite.style.height=`${height}px`;fitSprite(sprite,asset,width,height);button.append(sprite);
  const plate=document.createElement('span');plate.className='nameplate';plate.textContent=name;button.append(plate);
  if(type==='line'){
    const level=document.createElement('span');level.className='line-level';level.textContent=`Lv.${levels.get(id)||1}`;button.append(level);node.levelElement=level;button.dataset.lineId=id;button.dataset.level=String(levels.get(id)||1);button.dataset.inventory='0';
  }
  button.setAttribute('aria-label',type==='line'?`选择${name}，出厂${levels.get(id)||1}级`:`选择${name}`);
  button.addEventListener('click',()=>{if(!overview){selectNode(node);if($('phone').classList.contains('collapsed'))$('collapse-detail').click();}});node.element=button;nodes.set(id,node);world.append(button);return node;
}
function construction(slot){
  const button=document.createElement('button');button.type='button';button.className=`construction-slot${slot.disabled?' locked':''}`;
  const width=slot.product.width+24,height=115,left=slot.machineCx-width/2,top=slot.foot-90;
  Object.assign(button.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`});
  const sign=document.createElement('img');sign.src=vectors['expansion-plus-sign'].src;sign.alt='';sign.className='slot-sign';
  const label=document.createElement('span');label.className='slot-label';label.textContent=slot.disabled?'预留机位':slot.type==='product-slot'?'待建首条产线':`增开${slot.number}号线`;
  button.style.zIndex=String(100+Math.round(slot.foot));button.append(sign,label);button.setAttribute('aria-label',`${slot.product.name}${slot.number}号机位，${label.textContent}`);
  const node={...slot,name:`${slot.product.name} · ${slot.number}号机位`,asset:vectors['construction-platform'],left,top,width,height,element:button};
  button.addEventListener('click',()=>{if(!overview&&!slot.disabled){selectNode(node);if($('phone').classList.contains('collapsed'))$('collapse-detail').click();}});nodes.set(slot.id,node);world.append(button);
}
function focusGroup(group){
  if(!group||(!group.built&&layout.next?.id!==group.product.id))return;
  selectNode(selected?.product?.id===group.product.id?selected:nodes.get(`${group.product.id}-1`));frameGroup(group);
  if(upgrade?.isOpen)frameUpgradeSelection();
}
function frameGroup(group){courtyardView=false;workshopView=true;camera.fit(group.bounds,{padding:20,mode:'detail'});}
function renderGround(){
  renderWorkshopGround(world,layout);
  for(const group of layout.groups){
    const state=group.built?'':layout.next?.id===group.product.id?' next':' locked';
    caption(`${group.product.name} · ${group.count}/${group.maxLines}`,group.labelAnchor[0]-70,group.labelAnchor[1]-12,140,`workshop-title${state}`);
    const button=document.createElement('button');button.type='button';button.className=`overview-workshop${state}`;button.dataset.product=group.product.id;
    button.disabled=!group.built&&layout.next?.id!==group.product.id;
    const name=document.createElement('strong');name.textContent=group.product.name;
    const count=document.createElement('span');count.textContent=group.built?`${group.count}/${group.maxLines}`:button.disabled?'锁定':'待建';button.append(name,count);
    button.setAttribute('aria-label',`${group.product.name}工坊，${group.built?`${group.count}/${group.maxLines}条产线，进入`:button.disabled?'待解锁':'待扩建，进入'}`);
    button.addEventListener('click',()=>focusGroup(group));overlay.append(button);overviewLabels.set(group.product.id,{button,group});
  }
  caption('公共前庭',layout.courtyard.labelAnchor[0]-90,layout.courtyard.labelAnchor[1],180,'shared-label');
  caption('入口',layout.courtyard.entry[0]-36,layout.courtyard.entry[1]-12,72,'entry-label');
}
function renderWorld(focusId){
  layout=buildFactoryExpansionLayout(counts);nodes.clear();overviewLabels.clear();overlay.replaceChildren();world.replaceChildren();
  world.style.width=`${layout.width}px`;world.style.height=`${layout.height}px`;renderGround();
  logistics=renderWorkshopLogistics(world,layout);
  renderWorkshopBoundary(world,layout);
  caption('供料 ↑',layout.supplyLabel[0]-36,layout.supplyLabel[1]-28,64,'trunk-label supply-label');caption('成品 ↓',layout.returnLabel[0]-20,layout.returnLabel[1]-28,64,'trunk-label return-label');
  for(const slot of layout.slots){
    if(!slot.built){if(slot.next)construction(slot);continue;}
    const machine=mount(slot.product.machine,slot.id,`${slot.product.name} · ${slot.number}号线`,slot.machineCx,slot.foot,slot.width,'line',slot);
    mount('buffer-bin',`${slot.id}-buffer`,`${slot.number}号缓存`,slot.cacheCx,slot.cacheFoot,slot.cacheWidth,'cache',{lineId:slot.id,product:slot.product});
    machine.connections={input:slot.ground.input,output:slot.ground.output,cache:slot.ground.cacheEntry,supply:'supply',packaging:'packer'};
  }
  for(const device of Object.values(layout.shared))mount(device.assetId,device.id,device.name,device.cx,device.foot,device.width);
  motion.ready=motion.mount(world,layout,nodes);
  $('line-count').textContent=String(layout.lines.length);$('phone').dataset.lineCount=String(layout.lines.length);world.dataset.lineCount=String(layout.lines.length);world.dataset.productCount='6';
  renderJumps();selectNode(nodes.get(focusId)||nodes.get('original-1'));if(camera){camera.setBounds(layout.bounds);updateCamera(camera.getState());}
}
function renderJumps(){
  $('product-jumps').replaceChildren();
  for(const product of factoryProducts){
    const group=layout.groups.find(g=>g.product.id===product.id),button=document.createElement('button');button.type='button';button.textContent=product.name;
    button.disabled=!group.built&&layout.next?.id!==product.id;button.dataset.product=product.id;button.addEventListener('click',()=>focusGroup(group));$('product-jumps').append(button);
  }
}
function selectNode(node){
  if(!node)return;selected=node;for(const item of nodes.values())item.element.setAttribute('aria-pressed',String(item.id===node.id));$('detail-name').textContent=node.type==='cache'?`${node.product.name} · ${node.name}`:node.name;
  updateWorkshopLogistics(logistics,node.id);
  const collapsed=$('phone').classList.contains('collapsed');fitSprite($('detail-sprite'),node.asset,collapsed?44:72,collapsed?43:72);
  const line=node.type==='line',slot=node.type==='line-slot',product=node.product,index=product?factoryProducts.findIndex(p=>p.id===product.id):-1;
  $('detail-level').textContent=line?`出厂 Lv.${levels.get(node.id)||1}`:node.type==='product-slot'?'待建工坊':slot?'预留机位':node.type==='cache'?'本线独立缓存':'公共设备';
  $('detail-stock').textContent=line?'本线独立缓存':slot||node.type==='product-slot'?'仅布局演示':node.id==='warehouse'?`${layout.lines.length}条产线入仓`:node.type==='cache'?'本线待包缓存':'共享全厂';
  $('detail-help').textContent=line?'本线连接中央供料，经独立缓存汇入公共包装。':slot?`填入本坊第${node.number}机位；已有设备位置及等级保留。`:node.type==='product-slot'?'在预留工坊建设首线，接入中央物流。':node.type==='cache'?'接收所属产线出料，经成品输送槽送往公共包装。':node.id==='warehouse'?'包装完成后统一入仓。':'公共庭院服务全厂已建产线。';
  const canAdd=(line||slot)&&index>=0&&counts[index]>0&&counts[index]<layout.maxLinesPerProduct;
  $('build-line').disabled=!canAdd;$('build-line').textContent=canAdd?`预览增开${counts[index]+1}号线`:line?'本坊机位已满':'预览增开本线';
  $('build-product').disabled=!layout.next;$('build-product').textContent=layout.next?`扩建${layout.next.name}`:'六坊已全部装配';
  const upgradeNode=getUpgradeNode(node),canUpgrade=upgradeNode?.type==='line';
  $('level-select').disabled=!canUpgrade;$('level-select').value=String(canUpgrade?levels.get(upgradeNode.id)||1:1);$('focus-view').disabled=!product;
  $('upgrade-entry').textContent=node.type==='cache'?'升级所属产线':line?'升级设备':node.type.endsWith('slot')?'查看机位':'查看设施';
  const previousUpgradeId=upgrade?.selection?.id;
  upgrade?.update(getUpgradeSelection());
  if(upgrade?.isOpen&&previousUpgradeId!==upgrade.selection?.id)frameUpgradeSelection();
  for(const button of $('product-jumps').children)button.setAttribute('aria-pressed',String(button.dataset.product===product?.id));
  updatePresentation();
}
function updatePresentation(state=camera?.getState()){
  const safeBottom=upgrade?.isOpen?upgrade.sheet.offsetTop-viewport.offsetTop-8:viewport.clientHeight;
  presentation.update({nodes,selected,layout,camera,state,overview,workshopView,levels,safeBottom,overviewLabels});
}
function getUpgradeNode(node=selected){return node?.type==='cache'&&node.lineId?nodes.get(node.lineId):node;}
function getUpgradeSelection(){
  const node=getUpgradeNode();
  return node?{id:node.id,name:node.name,type:node.type,level:levels.get(node.id)||1,lineCount:layout.lines.length,productName:node.product?.name}:null;
}
function setLineLevel(node,level){
  levels.set(node.id,level);node.levelElement.textContent=`Lv.${level}`;node.element.dataset.level=String(level);
  node.element.setAttribute('aria-label',`选择${node.name}，出厂${level}级`);selectNode(selected);
}
function frameUpgradeSelection(){
  camera.resize();
  const node=getUpgradeNode();if(!node)return;
  const visibleHeight=Math.max(44,Math.min(viewport.clientHeight,upgrade.sheet.offsetTop-viewport.offsetTop));
  const zoom=Math.max(.65,camera.zoom);
  camera.setState({x:node.left+node.width/2,y:node.top+node.height/2+(viewport.clientHeight-visibleHeight)/2/zoom,zoom,mode:'detail'});
}
function updateCamera(state){
  const resized=viewWidth!==viewport.clientWidth||viewHeight!==viewport.clientHeight;viewWidth=viewport.clientWidth;viewHeight=viewport.clientHeight;
  if(resized&&workshopView&&camera&&!upgrade?.isOpen){const group=layout.groups.find(item=>item.product.id===selected?.product?.id);if(group){frameGroup(group);return;}}
  overview=!courtyardView&&!workshopView&&(state.mode==='overview'||(overview?state.zoom<.58:state.zoom<=.50));$('phone').classList.toggle('overview',overview);viewport.classList.toggle('overview',overview);overlay.hidden=!overview;
  $('zoom-level').textContent=`${Math.round(state.zoom*100)}%`;
  const currentGroup=layout?.groups.find(group=>group.product.id===selected?.product?.id);
  $('overview-view').setAttribute('aria-pressed',String(state.zoom<=state.minZoom+.0001));
  $('focus-view').setAttribute('aria-pressed',String(!overview&&!!currentGroup&&Math.hypot(state.x-currentGroup.center[0],state.y-currentGroup.center[1])<1));
  $('zoom-out').disabled=state.zoom<=state.minZoom+.0001;$('zoom-in').disabled=state.zoom>=state.maxZoom-.0001;
  for(const node of nodes.values())node.element.disabled=overview||!!node.disabled;if(!camera)return;
  for(const {button,group} of overviewLabels.values()){
    const p=camera.worldToViewport({x:group.labelAnchor[0],y:group.labelAnchor[1]});
    button.hidden=p.y < -23||p.y > viewport.clientHeight+23||p.x < -44||p.x > viewport.clientWidth+44;
    const x=group.column===0?Math.min(p.x-34,viewport.clientWidth/2-40):Math.max(p.x+34,viewport.clientWidth/2+40);
    button.style.left=`${Math.max(36,Math.min(viewport.clientWidth-36,x))}px`;button.style.top=`${Math.max(22,Math.min(viewport.clientHeight-22,p.y))}px`;
  }
  viewport.dataset.cameraX=state.x.toFixed(2);viewport.dataset.cameraY=state.y.toFixed(2);
  motion.setView(state,overview);
  updatePresentation(state);
}
function fitInitial(){courtyardView=false;workshopView=false;camera.fit(layout.lines.length<=2?layout.activeBounds:layout.bounds,{padding:20});}
function applyPreset(value){upgrade?.close();counts=[...factoryLayoutPresets[value]];levels.clear();renderWorld('original-1');upgrade?.reset();$('layout-select').value=value;if(camera)fitInitial();}

$('layout-select').addEventListener('change',event=>{applyPreset(event.target.value);$('demo-feedback').textContent='布局已切换；六坊及公共庭院位置固定，演示等级重置。';});
$('build-line').addEventListener('click',()=>{
  if(!selected?.product||$('build-line').disabled)return;const product=selected.product,index=factoryProducts.findIndex(p=>p.id===product.id),number=++counts[index],id=`${product.id}-${number}`;
  levels.set(id,1);renderWorld(id);$('layout-select').value='custom';focusGroup(layout.groups.find(g=>g.product.id===product.id));$('demo-feedback').textContent=`已填入${selected.name}，一级出厂；其他机位与等级保留。`;
});
$('build-product').addEventListener('click',()=>{
  if(!layout.next)return;const product=layout.next,index=factoryProducts.findIndex(p=>p.id===product.id);counts[index]=1;const id=`${product.id}-1`;levels.set(id,1);renderWorld(id);$('layout-select').value='custom';focusGroup(layout.groups.find(g=>g.product.id===product.id));$('demo-feedback').textContent=`${product.name}工坊已接入，首条产线装配完成。`;
});
$('level-select').addEventListener('change',event=>{
  const node=getUpgradeNode();if(node?.type!=='line')return;const level=Number(event.target.value);setLineLevel(node,level);$('demo-feedback').textContent=`${node.name}显示为${level}级，其他产线显示等级保留。`;
});
$('upgrade-entry').addEventListener('click',()=>{
  if(!upgrade)return;if(!upgrade.isOpen){upgradeCameraState={...camera.getState(),workshopView,courtyardView,width:viewport.clientWidth,height:viewport.clientHeight};upgradeStartSelectionId=getUpgradeNode()?.id;}
  upgrade.open(getUpgradeSelection());frameUpgradeSelection();
});
$('collapse-detail').addEventListener('click',()=>{const collapsed=$('phone').classList.toggle('collapsed');$('collapse-detail').setAttribute('aria-expanded',String(!collapsed));$('collapse-detail').setAttribute('aria-label',collapsed?'展开设备详情':'收起设备详情');if(selected)selectNode(selected);});
$('overview-view').addEventListener('click',()=>{courtyardView=false;workshopView=false;camera.fit(layout.bounds,{padding:20});});
$('focus-view').addEventListener('click',()=>focusGroup(layout.groups.find(g=>g.product.id===selected?.product?.id)));
$('zoom-out').addEventListener('click',()=>camera.zoomBy(1/1.25));$('zoom-in').addEventListener('click',()=>camera.zoomBy(1.25));
$('warehouse-view').addEventListener('click',()=>{selectNode(nodes.get('warehouse'));courtyardView=true;workshopView=false;camera.fit(layout.courtyard.bounds,{padding:18,mode:'detail'});if(upgrade?.isOpen)frameUpgradeSelection();});
$('catalog-view').addEventListener('click',()=>{const show=$('catalog').hidden;$('catalog').hidden=!show;$('catalog-view').setAttribute('aria-expanded',String(show));if(show)$('catalog').scrollIntoView({behavior:'smooth',block:'start'});});

try{
  await Promise.all([...runtimeFactoryAssets,...factoryDecorationAssets,...Object.values(vectors),runtimeFactoryFloor].map(asset=>loadImage(asset.src)));
  const preset=Object.hasOwn(factoryLayoutPresets,params.get('layout'))?params.get('layout'):'six';applyPreset(preset);
  camera=new WorkshopCamera(viewport,world,{onChange:updateCamera,onActivate:({type})=>{if(type!=='pan'){courtyardView=false;workshopView=false;}}});camera.setBounds(layout.bounds);fitInitial();
  upgrade=new WorkshopUpgrade({host:$('phone'),getSelection:getUpgradeSelection,onClose:()=>{
    camera.resize();const previous=upgradeCameraState,changed=getUpgradeNode()?.id!==upgradeStartSelectionId;upgradeCameraState=null;upgradeStartSelectionId=null;
    if(changed){const group=layout.groups.find(item=>item.product.id===selected?.product?.id);courtyardView=!group;if(group)frameGroup(group);else{workshopView=false;camera.fit(layout.courtyard.bounds,{padding:18,mode:'detail'});}}
    else if(previous){
      workshopView=previous.workshopView;courtyardView=previous.courtyardView;
      const resized=previous.width!==viewport.clientWidth||previous.height!==viewport.clientHeight;
      const group=layout.groups.find(item=>item.product.id===selected?.product?.id);
      if(resized&&workshopView&&group)frameGroup(group);
      else if(resized&&courtyardView)camera.fit(layout.courtyard.bounds,{padding:18,mode:'detail'});
      else camera.setState(previous);
    }
  },onUpgrade:({id,fromLevel,toLevel})=>{
    const node=getUpgradeNode();if(node?.type!=='line'||node.id!==id||(levels.get(id)||1)!==fromLevel)return false;
    setLineLevel(node,toLevel);$('demo-feedback').textContent=`${node.name}已升至 Lv.${toLevel}，其他产线等级保留。`;return true;
  }});
  if(params.get('collapsed')==='false')$('collapse-detail').click();
  const position=params.get('position');if(position==='warehouse')$('warehouse-view').click();else if(position)focusGroup(layout.groups.find(g=>g.product.id===position));
  await motion.ready;
  for(const asset of [...Object.values(vectors),...factoryDecorationAssets,...runtimeFactoryAssets,runtimeFactoryFloor]){
    const card=document.createElement('a');card.className='asset-card';card.href=asset.src;card.target='_blank';card.rel='noopener';const display=document.createElement('div');display.className='asset-display';const img=document.createElement('img');img.src=asset.src;img.alt=asset.label||asset.id||'运行地面';display.append(img);const title=document.createElement('strong');title.textContent=asset.label||asset.id||'运行地面';card.append(display,title);$('catalog').append(card);
  }
  $('load-status').textContent=`运行素材已载入：六坊、${factoryProducts.length*layout.maxLinesPerProduct}个固定机位、中央供料与成品回流、前庭公共配套。`;document.documentElement.dataset.ready='true';
}catch(error){$('load-status').textContent=error.message;document.documentElement.dataset.ready='error';console.error(error);}
