import { factoryBitmapAssets, factoryVectorAssets, factoryAssembly } from '../../assets/source/factory/manifest.js';
import { factoryLogisticsAssets } from '../../assets/source/factory/logistics/v1/manifest.js';
import { factoryUIAssets } from '../../assets/source/factory/ui/v1/manifest.js';
import { factoryDynamicBitmapAssets, factoryMotionVectorAssets } from '../../assets/source/factory/animation/v1/rigs.js';
import { factoryStateAssets } from '../../assets/source/factory/states/v1/manifest.js';
import { FactoryPreviewModel, PREVIEW_SCENARIOS } from './production-model.js';
import { FactoryAnimationScene, selectedDeviceState } from './production-animation.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
if(params.get('capture')==='phone') document.body.classList.add('capture-mode');
const allBitmapAssets=[...factoryBitmapAssets,...factoryDynamicBitmapAssets];
const stateVectors=[...Object.values(factoryStateAssets.badges),factoryStateAssets['selection-ring'],factoryStateAssets['contact-shadow'],factoryStateAssets['progress-track'],factoryStateAssets['progress-fill']].map(asset=>({...asset,label:asset.label||({'selection-ring':'设备选中环','contact-shadow':'接触阴影','progress-track':'进度槽','progress-fill':'进度填充'})[asset.id],group:'states',version:'v1',type:'svg'}));
const allVectorAssets=[...factoryVectorAssets,...factoryMotionVectorAssets,...stateVectors];
const assets = new Map(allBitmapAssets.map(asset=>[asset.id,asset]));
let model=new FactoryPreviewModel({scenario:PREVIEW_SCENARIOS.includes(params.get('scenario'))?params.get('scenario'):'normal'});
let animation,paused=params.get('paused')==='true',lastFrame=0,lastDetailTime=0;
const beltPieces=[];
const cached = new Map();
function loadSprite(src, bounds) {
  if(cached.has(src))return cached.get(src);
  const promise = new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload=()=>{
      if(!bounds){
        const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
        const pixels=ctx.getImageData(0,0,img.width,img.height).data;
        let x0=img.width,y0=img.height,x1=0,y1=0;
        for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++)if(pixels[(y*img.width+x)*4+3]>16){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
        bounds=[x0,y0,x1,y1];canvas.width=canvas.height=1;
      }
      resolve({src,width:img.width,height:img.height,bounds});
    };
    img.onerror=()=>reject(new Error(`资源未载入：${src.split('/').pop()}`));img.src=src;
  });cached.set(src,promise);return promise;
}
function fitSprite(container, sprite, width, height) {
  const [x0,y0,x1,y1]=sprite.bounds;
  const scale=Math.min(width/(x1-x0),height/(y1-y0));
  const img=document.createElement('img');img.src=sprite.src;img.alt='';img.draggable=false;
  Object.assign(img.style,{width:`${sprite.width*scale}px`,height:`${sprite.height*scale}px`,left:`${(width-(x1-x0)*scale)/2-x0*scale}px`,top:`${(height-(y1-y0)*scale)/2-y0*scale}px`});
  container.replaceChildren(img);
}

const machineRoot=new URL('../../assets/source/gameplay/machines/artwork/v5/',import.meta.url);
const items=[
  { id:'supply',asset:'supply-body-clean',name:'公共供料',world:[268,175],width:114,anchor:.91,capacity:'供料 Lv.1',stock:'基础爆米花',platform:true },
  { id:'original-1',name:'原味 · 1号线',world:[156,423],width:156,anchor:.88,src:new URL('air-popper.png',machineRoot).href,capacity:'出厂 Lv.1',stock:'库存 0',platform:true },
  { id:'original-buffer',asset:'buffer-bin',name:'本地待包',world:[288,437],width:43,anchor:.88,capacity:'原味 · 待包装',stock:'缓存 0',small:true },
  { id:'caramel-1',name:'焦糖 · 1号线',world:[156,878],width:154,anchor:.9,src:new URL('caramel-drum.png',machineRoot).href,capacity:'出厂 Lv.1',stock:'库存 12',platform:true,caramel:true },
  { id:'caramel-buffer',asset:'buffer-bin',name:'本地待包',world:[288,892],width:43,anchor:.88,capacity:'焦糖 · 待包装',stock:'缓存 0',small:true },
  { id:'public-buffer',asset:'buffer-bin',name:'公共待包',world:[426,1035],width:40,anchor:.88,capacity:'公共包装队列',stock:'缓存 0',small:true },
  { id:'packer',asset:'packer-body-clean',name:'公共包装',world:[326,1270],width:164,anchor:.87,capacity:'包装 Lv.1',stock:'公共设备',platform:true },
  { id:'warehouse',name:'统一仓储',world:[235,1730],width:236,anchor:.95,capacity:'原味 24',stock:'焦糖 12',platform:true },
];

const ns='http://www.w3.org/2000/svg';
function svgImage(src, center, matrix=[.6,0,0,.6],target=$('logistics')){
  const group=document.createElementNS(ns,'g');group.setAttribute('transform',`translate(${center[0]} ${center[1]}) matrix(${matrix.join(' ') } 0 0)`);
  const img=document.createElementNS(ns,'image');img.setAttribute('href',src);img.setAttribute('x','-48');img.setAttribute('y','-48');img.setAttribute('width','96');img.setAttribute('height','96');group.append(img);target.append(group);
}
const beltBase=new URL('../../assets/source/factory/logistics/v1/',import.meta.url);
function tile(id,center){svgImage(new URL(`${id}.svg`,beltBase).href,center);}
function portVector(direction){const point=factoryLogisticsAssets.assets['junction-'+(direction==='west'?'west':'east')].ports[direction];return[(point.x-48)*.6,(point.y-48)*.6];}
function direction(from,to){const dx=to[0]-from[0],dy=to[1]-from[1];return Math.abs(dx)>Math.abs(dy)?(dx>0?'east':'west'):(dy>0?'south':'north');}
function warpStraight(a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],horizontal=Math.abs(dx)>Math.abs(dy);
  const f=Math.abs(horizontal?dx:dy)/48;
  const hx=horizontal?f:1,vy=horizontal?1:f;
  const shear=.138,depth=-.1333333333,det=1-shear*depth;
  const matrix=[(hx-depth*vy*shear)/det*.6,(shear*hx-vy*shear)/det*.6,(-hx*depth+depth*vy)/det*.6,(-shear*hx*depth+vy)/det*.6];
  if(Math.hypot(dx,dy)>.3){const center=[(a[0]+b[0])/2,(a[1]+b[1])/2];svgImage(new URL(`straight-${horizontal?'h':'v'}.svg`,beltBase).href,center,matrix);beltPieces.push({center,matrix,horizontal,direction:Math.sign(horizontal?dx:dy),motionTime:0});}
}
function renderRoute(nodes){
  const points=nodes.map(node=>({...node,p:factoryAssembly.project(...node.at)}));
  for(let i=1;i<points.length;i++){
    const start=points[i-1],end=points[i],dir=direction(start.p,end.p),opp={east:'west',west:'east',north:'south',south:'north'}[dir];
    const sv=start.tile?portVector(dir):[0,0],ev=end.tile?portVector(opp):[0,0];
    warpStraight([start.p[0]+sv[0],start.p[1]+sv[1]],[end.p[0]+ev[0],end.p[1]+ev[1]]);
  }
  points.forEach(node=>{if(node.tile)tile(node.tile,node.p);});
}
// Dedicated supply and finished-material trunks. Each product joins the public packer.
renderRoute([{at:[237,150]},{at:[31,150],tile:'corner-se'},{at:[31,423],tile:'junction-east'},{at:[31,878],tile:'corner-ne'}]);
renderRoute([{at:[31,423],tile:'junction-east'},{at:[84,423]}]);
renderRoute([{at:[31,878],tile:'corner-ne'},{at:[84,878]}]);
renderRoute([{at:[310,423]},{at:[435,423],tile:'corner-sw'},{at:[435,878],tile:'junction-west'},{at:[435,1230],tile:'corner-nw'},{at:[224,1230]}]);
renderRoute([{at:[310,878]},{at:[435,878],tile:'junction-west'}]);
renderRoute([{at:[406,1264]},{at:[406,1390],tile:'corner-nw'},{at:[242,1390],tile:'corner-se'},{at:[242,1600]}]);
for(const at of [[237,150],[84,423],[84,878],[310,423],[310,878],[224,1230]])tile('connector',factoryAssembly.project(...at));
const foreground=document.createElementNS(ns,'svg');foreground.setAttribute('viewBox','0 0 390 840');foreground.classList.add('logistics-foreground');foreground.setAttribute('aria-hidden','true');$('world').append(foreground);
for(const piece of beltPieces){const asset=factoryMotionVectorAssets.find(entry=>entry.id===`foreground-rail-${piece.horizontal?'h':'v'}`);svgImage(asset.src,piece.center,piece.matrix,foreground);}

let selected;
function selectItem(item){
  selected=item;
  items.forEach(entry=>entry.element.setAttribute('aria-pressed',String(entry===item)));
  $('detail-name').textContent=item.name;$('detail-level').textContent=item.capacity;$('detail-stock').textContent=item.stock;
  const collapsed=$('phone').classList.contains('collapsed');fitSprite($('detail-sprite'),item.thumbnail||item.sprite,collapsed?44:76,collapsed?43:64);
  const production=['supply','packer','original-1','caramel-1'].includes(item.id);
  $('detail').querySelector('.blue').hidden=!production;$('detail').querySelector('.green').hidden=!production;
  $('detail').querySelector('.gold').hidden=!['original-1','caramel-1'].includes(item.id);
  updateDetails();
}
function updateDetails(){if(!selected)return;const state=selectedDeviceState(selected,model.snapshot());$('detail-level').textContent=state.status+(state.progress!==null&&state.progress>0?` ${Math.round(state.progress*100)}%`:'');$('detail-stock').textContent=state.summary;$('detail-stock').title=state.summaryDetail||'';$('detail-stock').setAttribute('aria-label',state.summaryDetail?`${state.summary}，${state.summaryDetail}`:state.summary);const accelerate=$('detail').querySelector('.blue');accelerate.disabled=!state.accelerate?.enabled;accelerate.title=state.accelerate?.reason||'推进当前工序';accelerate.setAttribute('aria-label',state.accelerate?.enabled?'加速':`加速不可用：${state.accelerate?.reason||'当前设备没有加工工序'}`);}
const failures=[];
await Promise.all(items.map(async(item,index)=>{
  const asset=assets.get(item.asset||item.id);
  try{
    item.sprite=await loadSprite(item.src||asset.src,asset?.bounds);
    if(item.id==='supply'||item.id==='packer'){const original=assets.get(item.id);item.thumbnail=await loadSprite(original.src,original.bounds);}
    const [x0,y0,x1,y1]=item.sprite.bounds;const height=item.width*(y1-y0)/(x1-x0);
    const [x,y]=factoryAssembly.project(...item.world);
    const button=document.createElement('button');button.type='button';button.className=`equipment-item${item.small?' small':''}${item.caramel?' caramel':''}`;
    Object.assign(button.style,{left:`${x-item.width/2}px`,top:`${y-height*item.anchor}px`,width:`${item.width}px`,height:`${height}px`,zIndex:String(10+index)});
    button.setAttribute('aria-label',`选择${item.name}`);button.setAttribute('aria-pressed','false');
    if(item.platform){const platform=document.createElement('img');platform.src=assets.get('platform').src;platform.className='ground-platform';platform.alt='';button.append(platform);}
    const ring=document.createElement('span');ring.className='selection';button.append(ring);
    const sprite=document.createElement('div');sprite.className='sprite';fitSprite(sprite,item.sprite,item.width,height);button.append(sprite);
    const plate=document.createElement('span');plate.className='nameplate';
    if(item.id.endsWith('-1')){const dot=document.createElement('i');dot.className='dot';plate.append(dot);}
    plate.append(document.createTextNode(item.name));button.append(plate);
    button.addEventListener('click',()=>selectItem(item));item.element=button;$('equipment').append(button);
  }catch(error){failures.push(error.message);}
}));

const inlineSprites=[
  ['customer','../../assets/source/characters/customers/v2/rabbit-courier.png',67,67],
  ['order-original','../../assets/source/gameplay/products/v9/original/lv-01.png',47,33],
  ['order-caramel','../../assets/source/gameplay/products/v9/caramel/lv-01.png',47,33],
];
await Promise.all(inlineSprites.map(async([id,path,w,h])=>{
  try{fitSprite($(id),await loadSprite(new URL(path,import.meta.url).href),w,h);}catch(error){failures.push(error.message);}
}));
if(!failures.length)selectItem(items.find(item=>item.id===(params.get('selection')||'original-1'))||items[1]);
$('collapse-detail').addEventListener('click',()=>{
  const collapsed=$('phone').classList.toggle('collapsed');
  $('collapse-detail').setAttribute('aria-expanded',String(!collapsed));$('collapse-detail').setAttribute('aria-label',collapsed?'展开设备详情':'收起设备详情');
  if(selected)fitSprite($('detail-sprite'),selected.thumbnail||selected.sprite,collapsed?44:76,collapsed?43:64);
});
$('top-view').addEventListener('click',()=>{$('scene-viewport').scrollTo({top:0,behavior:'smooth'});});
$('warehouse-view').addEventListener('click',()=>{$('scene-viewport').scrollTo({top:800,behavior:'smooth'});const warehouse=items.find(item=>item.id==='warehouse');if(warehouse?.element)selectItem(warehouse);});
$('catalog-view').addEventListener('click',()=>{const show=$('catalog').hidden;$('catalog').hidden=!show;$('catalog-view').setAttribute('aria-expanded',String(show));if(show)$('catalog').scrollIntoView({behavior:'smooth',block:'start'});});

for(const asset of [...allBitmapAssets,...allVectorAssets]){
  const card=document.createElement('a');card.className='asset-card';card.href=asset.src;card.target='_blank';card.rel='noopener';
  const display=document.createElement('div');display.className='asset-display';
  if(asset.id==='icons'){const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 48 48');svg.style.height='72px';svg.style.color='#486f59';const use=document.createElementNS(ns,'use');use.setAttribute('href',`${asset.src}#factory`);svg.append(use);display.append(svg);}
  else{const img=document.createElement('img');img.src=asset.src;img.alt=asset.label;display.append(img);}
  const label=document.createElement('strong');label.textContent=asset.label;
  const filename=document.createElement('small');filename.textContent=`${asset.group}/${asset.version||'v1'}/${asset.id}.${asset.type}`;
  card.append(display,label,filename);$('catalog').append(card);
}
function resizeScene(){const ratio=$('scene-viewport').clientWidth/390;$('world').style.zoom=String(ratio);}
resizeScene();window.addEventListener('resize',resizeScene);
if(params.get('position')==='warehouse')$('scene-viewport').scrollTop=800;
if(params.get('collapsed')==='true')$('collapse-detail').click();
if(!failures.length){
  try{animation=new FactoryAnimationScene(items,beltPieces);await animation.load();}
  catch(error){failures.push(error.message);console.error(error);}
}
const captureTime=Number(params.get('time')||0);if(Number.isFinite(captureTime)&&captureTime>0&&captureTime<=180)model.advance(captureTime);
$('scenario-select').value=model.scenario;
function refresh(force=true){const snapshot=model.snapshot();if(animation&&force){animation.draw(snapshot);animation.updateInterface(snapshot);}updateDetails();$('phone').dataset.scenario=snapshot.scenario;$('phone').dataset.previewTime=snapshot.time.toFixed(2);for(const item of items){const line=snapshot.lines.find(entry=>entry.id===item.id);if(line){item.element.dataset.phase=line.phase;item.element.dataset.progress=String(line.progress);item.element.dataset.inventory=String(line.inventory);item.element.dataset.cache=String(line.cache.count);}}$('world').dataset.originalInventory=String(snapshot.inventory.original);$('world').dataset.caramelInventory=String(snapshot.inventory.caramel);}
function updatePlaybackButton(){$('play-pause').textContent=paused?'继续演示':'暂停演示';$('play-pause').setAttribute('aria-pressed',String(paused));}
$('scenario-select').addEventListener('change',event=>{model.setScenario(event.target.value);refresh();$('demo-feedback').textContent=event.target.value==='normal'?'补料和包装恢复，等待批次自动继续。':'场景条件已切换；已开始的批次保留。';});
$('play-pause').addEventListener('click',()=>{paused=!paused;lastFrame=0;updatePlaybackButton();refresh();});
$('advance-preview').addEventListener('click',()=>{model.advance(1);refresh();});
$('reset-preview').addEventListener('click',()=>{model=new FactoryPreviewModel({scenario:$('scenario-select').value});if(animation)animation.lastInterface=-1;lastFrame=0;refresh();$('demo-feedback').textContent='演示状态已重置。';});
$('detail').querySelector('.blue').addEventListener('click',()=>{if(!selected)return;const result=model.accelerate(selected.id);refresh();$('demo-feedback').textContent=result.ok?`${selected.name}当前工序已推进。`:result.reason;});
for(const color of ['blue','green','gold']){const button=$('detail').querySelector(`.${color}`),skin=factoryUIAssets.assets[`button-${color}`],s=skin.nineSlice;button.classList.add('nine-slice-skin');button.style.borderImageSource=`url("${new URL(`../../assets/source/factory/ui/v1/${skin.src}`,import.meta.url).href}")`;button.style.borderImageSlice=`${s.top} ${s.right} ${s.bottom} ${s.left} fill`;}
function frame(now){const dt=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;if(!paused&&!document.hidden)model.advance(dt);if(animation)animation.draw(model.snapshot());if(now-lastDetailTime>100){refresh(false);lastDetailTime=now;}requestAnimationFrame(frame);}
document.addEventListener('visibilitychange',()=>{lastFrame=0;});
updatePlaybackButton();refresh();
$('load-status').textContent=failures.length?failures.join('；'):`已载入 ${allBitmapAssets.length} 张 PNG、${allVectorAssets.length} 个 SVG。原味与焦糖机器动画复用，入库由工序演示状态驱动。`;
document.documentElement.dataset.ready=failures.length?'error':'true';
if(!failures.length)requestAnimationFrame(frame);
