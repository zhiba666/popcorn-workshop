import {runtimeFactoryAssets,runtimeFactoryAssetsById as bitmaps} from '../../assets/runtime/factory/v1/manifest.js';
import {runtimeFactoryFloor} from '../../assets/runtime/factory/v1/floor.js';
import {factoryExpansionAssets} from '../../assets/source/factory/expansion/v1/manifest.js';
import {factoryDecorationAssets} from '../../assets/runtime/decoration/v1/manifest.js';
import {factoryProducts,factoryLayoutPresets,buildFactoryExpansionLayout} from '../../assets/source/factory/expansion/v1/layout.js';

const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
const params=new URLSearchParams(location.search),vectors=factoryExpansionAssets.assets;
const base=new URL('../../assets/source/factory/logistics/v1/',import.meta.url);
const definitions=new Map([...runtimeFactoryAssets,...factoryDecorationAssets].map(asset=>[asset.id,asset]));
const levels=new Map(),nodes=new Map(),groupPositions=new Map(),images=new Map();
let counts=[...factoryLayoutPresets.six],layout,selected,layer;
if(params.get('capture')==='phone')document.body.classList.add('capture-mode');

function loadImage(src){
  if(images.has(src))return images.get(src);
  const promise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`资源未载入：${src.split('/').pop()}`));img.src=src;});
  images.set(src,promise);return promise;
}
function fitSprite(container,asset,width,height){
  const [x0,y0,x1,y1]=asset.bounds||[0,0,...asset.size],scale=Math.min(width/(x1-x0),height/(y1-y0));
  const img=document.createElement('img');img.src=asset.src;img.alt='';img.draggable=false;
  Object.assign(img.style,{position:'absolute',width:`${asset.size[0]*scale}px`,height:`${asset.size[1]*scale}px`,left:`${(width-(x1-x0)*scale)/2-x0*scale}px`,top:`${(height-(y1-y0)*scale)/2-y0*scale}px`});
  container.replaceChildren(img);
}
function svgImage(src,center,matrix=[.5,0,0,.5],size=[96,96]){
  const group=document.createElementNS(ns,'g');group.setAttribute('transform',`translate(${center.join(' ')}) matrix(${matrix.join(' ')} 0 0)`);
  const image=document.createElementNS(ns,'image');image.setAttribute('href',src);image.setAttribute('x',String(-size[0]/2));image.setAttribute('y',String(-size[1]/2));image.setAttribute('width',String(size[0]));image.setAttribute('height',String(size[1]));group.append(image);layer.append(group);
}
function tile(id,point){svgImage(new URL(`${id}.svg`,base).href,point);}
function straight(from,to){
  let a=from,b=to;const horizontal=Math.abs(b[0]-a[0])>=Math.abs(b[1]-a[1]);
  if(horizontal?b[0]<a[0]:b[1]<a[1])[a,b]=[b,a];
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<.2)return;
  const [sx,sy,cx,cy]=horizontal?[80,11.04,-.1333333333,1]:[-10.6666666667,80,1,.138];
  const wx=(horizontal?-dy:dy)/length*.5,wy=(horizontal?dx:-dx)/length*.5,det=sx*cy-cx*sy;
  const matrix=[(dx*cy-wx*sy)/det,(dy*cy-wy*sy)/det,(-dx*cx+wx*sx)/det,(-dy*cx+wy*sx)/det];
  svgImage(new URL(`straight-${horizontal?'h':'v'}.svg`,base).href,[(a[0]+b[0])/2,(a[1]+b[1])/2],matrix);
}
function route(points){for(let i=1;i<points.length;i++)straight(points[i-1],points[i]);}
function corner(id,point){tile(`corner-${id}`,point);}
function stamp(id,x,y,width){const asset=vectors[id],img=document.createElement('img');img.src=asset.src;img.alt='';img.className='expansion-stamp';Object.assign(img.style,{left:`${x}px`,top:`${y}px`,width:`${width}px`});$('world').append(img);return img;}
function caption(text,x,y,width,className='zone-label'){
  const label=document.createElement('div');label.className=className;label.textContent=text;Object.assign(label.style,{left:`${x}px`,top:`${y}px`,width:`${width}px`});$('world').append(label);return label;
}
function mount(assetId,id,name,cx,foot,width,type='shared',data={}){
  const asset=definitions.get(assetId),[x0,y0,x1,y1]=asset.bounds,scale=width/(x1-x0),height=(y1-y0)*scale;
  const anchor=type==='line'?.88:.9,left=cx-width/2,top=foot-height*anchor;
  const node={id,name,type,asset,left,top,width,height,foot,...data};
  const button=document.createElement('button');button.type='button';button.className=`equipment-item${type==='cache'?' small':''}`;button.dataset.deviceId=id;button.setAttribute('aria-pressed','false');
  Object.assign(button.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${Math.max(44,height)}px`,zIndex:type==='cache'?'21':'20'});
  if(type!=='cache'){
    const platform=document.createElement('div');platform.className='expansion-platform';fitSprite(platform,bitmaps.platform,width*1.12,width*.42);button.append(platform);
  }
  const ring=document.createElement('span');ring.className='selection';button.append(ring);
  const sprite=document.createElement('div');sprite.className='sprite';sprite.style.height=`${height}px`;fitSprite(sprite,asset,width,height);button.append(sprite);
  const plate=document.createElement('span');plate.className='nameplate';plate.textContent=name;button.append(plate);
  if(type==='line'){
    const level=document.createElement('span');level.className='line-level';level.textContent=`Lv.${levels.get(id)||1}`;button.append(level);node.levelElement=level;button.dataset.lineId=id;button.dataset.level=String(levels.get(id)||1);button.dataset.inventory='0';
  }
  button.setAttribute('aria-label',type==='line'?`选择${name}，出厂${levels.get(id)||1}级`:`选择${name}`);
  button.addEventListener('click',()=>selectNode(node));node.element=button;nodes.set(id,node);$('world').append(button);
  node.point=point=>[left+(point[0]-x0)*scale,top+(point[1]-y0)*scale];
  node.sourcePoint=point=>[left+(point[0]-asset.originalBounds[0])*width/(asset.originalBounds[2]-asset.originalBounds[0]),top+(point[1]-asset.originalBounds[1])*height/(asset.originalBounds[3]-asset.originalBounds[1])];
  return node;
}
function construction(slot){
  const button=document.createElement('button');button.type='button';button.className='construction-slot';Object.assign(button.style,{left:'76px',top:`${slot.y+10}px`,width:'236px',height:slot.type==='product-slot'?'154px':'92px'});
  const platform=document.createElement('img');platform.src=vectors['construction-platform'].src;platform.alt='';platform.className='slot-platform';
  const sign=document.createElement('img');sign.src=vectors['expansion-plus-sign'].src;sign.alt='';sign.className='slot-sign';
  const label=document.createElement('span');label.className='slot-label';label.textContent=slot.type==='product-slot'?`扩建${slot.product.zone}`:`新增${slot.product.name} · ${slot.number}号线`;
  button.append(platform,sign,label);button.setAttribute('aria-label',`选择${label.textContent}建设区域`);
  const node={...slot,name:label.textContent,asset:vectors['construction-platform'],width:128,height:104,element:button};
  button.addEventListener('click',()=>selectNode(node));nodes.set(slot.id,node);$('world').append(button);
  svgImage(vectors['branch-sealed-cap'].src,[layout.supplyTrunkX+20,slot.y+44]);
  svgImage(vectors['branch-connection-slot'].src,[layout.finishedTrunkX-20,slot.y+69],[-.5,0,0,.5]);
}
function decorate(){
  for(let i=0;i<layout.groups.length;i++){
    const group=layout.groups[i],asset=factoryDecorationAssets[i%2];
    const decoration=document.createElement('div');decoration.className='expansion-decoration';Object.assign(decoration.style,{left:'4px',top:`${group.y+58}px`,width:'31px',height:'42px'});fitSprite(decoration,asset,31,42);$('world').append(decoration);
    stamp('pipe-v',7,group.y+118,30);
    stamp('floor-transition-h',82,group.bottom+1,236);
  }
  for(const [i,asset] of factoryDecorationAssets.entries()){
    const decoration=document.createElement('div');decoration.className='expansion-decoration';Object.assign(decoration.style,{left:`${i?320:10}px`,top:`${layout.sharedY+210}px`,width:'45px',height:'58px'});fitSprite(decoration,asset,45,58);$('world').append(decoration);
  }
}
function renderWorld(focusId){
  layout=buildFactoryExpansionLayout(counts);nodes.clear();groupPositions.clear();const world=$('world');world.replaceChildren();world.style.height=`${layout.height}px`;world.style.backgroundImage=`url("${runtimeFactoryFloor.src}")`;
  const back=document.createElement('img');back.className='back-wall';back.src=bitmaps['wall-back'].src;back.alt='厂房后墙';world.append(back);
  layer=document.createElementNS(ns,'svg');layer.classList.add('expansion-scene-layer');layer.setAttribute('viewBox',`0 0 390 ${layout.height}`);layer.setAttribute('height',String(layout.height));layer.setAttribute('aria-label','左侧公共供料、右侧汇流、包装后统一仓储');world.append(layer);
  const supply=mount('supply-complete','supply','公共供料',253,164,116);
  const output=supply.point(supply.asset.draw.ports.output);route([output,[layout.supplyTrunkX,output[1]],[layout.supplyTrunkX,layout.sharedY-20]]);corner('se',[layout.supplyTrunkX,output[1]]);
  for(const group of layout.groups){
    groupPositions.set(group.product.id,group.y);const title=caption(`${group.index+1}代 · ${group.product.zone}  ${group.count}/3`,81,group.y,232,'product-label');title.style.backgroundImage=`url("${vectors['product-zone-nameplate'].src}")`;
  }
  const branchY=[];
  for(const line of layout.lines){
    const machine=mount(line.product.machine,line.id,`${line.product.name} · ${line.number}号线`,171,line.foot,line.product.width,'line',line);
    const buffer=mount('buffer-bin',`${line.id}-buffer`,'本地待包',287,line.foot+12,42,'cache',{lineId:line.id,product:line.product});
    const input=machine.point(machine.asset.draw.ports.input),terminal=machine.sourcePoint(line.product.terminal),cachePoint=[283,line.foot-12];
    const feedStart=[layout.supplyTrunkX+20,input[1]];route([feedStart,[input[0]-12,input[1]],input]);tile('junction-east',[layout.supplyTrunkX,input[1]-2.76]);tile('connector',input);
    if(line.product.frontReturn){
      const turnY=line.foot+49;route([terminal,[terminal[0],turnY],[263,turnY],[263,cachePoint[1]],cachePoint]);corner('ne',[terminal[0],turnY]);corner('nw',[263,turnY]);corner('se',[263,cachePoint[1]]);
    }else route([terminal,[cachePoint[0],terminal[1]],cachePoint]);
    tile('connector',terminal);
    const join=[layout.finishedTrunkX,line.foot];route([[306,line.foot],[layout.finishedTrunkX-20,line.foot]]);tile('junction-west',[join[0],join[1]+2.76]);branchY.push(join[1]);
    machine.connections={input,output:terminal,cache:cachePoint,supply:'supply',packaging:'packer'};
  }
  for(const slot of layout.slots)construction(slot);
  const packer=mount('packer-complete','packer','公共包装',215,layout.sharedY+139,173),input=packer.point(packer.asset.draw.ports.input),packOutput=packer.point(packer.asset.draw.ports.output);
  const bypassY=packer.top-23;route([[layout.finishedTrunkX,branchY[0]],[layout.finishedTrunkX,bypassY],[111,bypassY],[111,input[1]],input]);corner('nw',[layout.finishedTrunkX,bypassY]);corner('se',[111,bypassY]);corner('ne',[111,input[1]]);tile('connector',input);
  mount('buffer-bin','public-buffer','公共待包',341,bypassY-14,41,'cache');
  const warehouse=mount('warehouse','warehouse','统一仓储',193,layout.sharedY+287,236);
  const destination=[195,warehouse.top+14],turnY=packer.foot+36;route([packOutput,[packOutput[0],turnY],[195,turnY],destination]);corner('nw',[packOutput[0],turnY]);corner('se',[195,turnY]);tile('connector',packOutput);
  decorate();
  $('line-count').textContent=String(layout.lines.length);$('phone').dataset.lineCount=String(layout.lines.length);world.dataset.lineCount=String(layout.lines.length);world.dataset.productCount=String(layout.groups.length);
  renderJumps();resizeWorld();selectNode(nodes.get(focusId)||nodes.get('original-1'));
}
function renderJumps(){
  $('product-jumps').replaceChildren();
  for(const product of factoryProducts){const button=document.createElement('button');button.type='button';button.textContent=product.name;button.disabled=!groupPositions.has(product.id)&&layout.next?.id!==product.id;button.addEventListener('click',()=>{
    const node=nodes.get(`${product.id}-1`)||(layout.next?.id===product.id?nodes.get('next-product'):null);if(node){selectNode(node);scrollToNode(node);}
  });button.dataset.product=product.id;$('product-jumps').append(button);}
}
function selectNode(node){
  selected=node;for(const item of nodes.values())item.element.setAttribute('aria-pressed',String(item.id===node.id));
  $('detail-name').textContent=node.name;
  const collapsed=$('phone').classList.contains('collapsed');fitSprite($('detail-sprite'),node.asset,collapsed?44:72,collapsed?43:72);
  const line=node.type==='line',slot=node.type==='line-slot',product=node.product;
  $('detail-level').textContent=line?`出厂 Lv.${levels.get(node.id)||1}`:node.type==='product-slot'?'下一代':slot?'待建设':'公共设备';
  $('detail-stock').textContent=line?'独立库存 0':slot||node.type==='product-slot'?'费用待定':node.id==='warehouse'?`${layout.lines.length}条线独立库存`:node.type==='cache'?'待包缓存':'共享全厂';
  $('detail-help').textContent=line?'本线接入公共供料与包装。':slot?'新线从一级出厂起步，保留其他产线规格。':node.type==='product-slot'?'新品首条线和物流同时接入。':node.id==='warehouse'?'各条流水线分别记账。':'公共环节服务各条已装配产线。';
  const canAdd=(line||slot)&&counts[factoryProducts.findIndex(p=>p.id===product.id)]<3;
  $('build-line').disabled=!canAdd;$('build-line').textContent=canAdd?`预览新增${counts[factoryProducts.findIndex(p=>p.id===product.id)]+1}号线`:line?'本产品已达3条':'预览增开本线';
  $('build-product').disabled=!layout.next;$('build-product').textContent=layout.next?'预览扩建新品':'六代已全部装配';
  $('level-select').disabled=!line;$('level-select').value=String(line?levels.get(node.id)||1:1);
  for(const button of $('product-jumps').children)button.setAttribute('aria-pressed',String(button.dataset.product===product?.id));
}
function scrollToNode(node){const scale=$('scene-viewport').clientWidth/390;const y=node.type==='line'?node.y-44:node.type.endsWith('slot')?node.y:node.top-24;$('scene-viewport').scrollTo({top:Math.max(0,y*scale),behavior:'instant'});}
function resizeWorld(){$('world').style.zoom=String($('scene-viewport').clientWidth/390);}
function applyPreset(value){counts=[...factoryLayoutPresets[value]];levels.clear();renderWorld('original-1');$('layout-select').value=value;$('scene-viewport').scrollTop=0;}

$('layout-select').addEventListener('change',event=>{applyPreset(event.target.value);$('demo-feedback').textContent='已切换装配布局；演示等级重置为一级。';});
$('build-line').addEventListener('click',()=>{
  if(!selected?.product||$('build-line').disabled)return;const index=factoryProducts.findIndex(p=>p.id===selected.product.id),number=++counts[index],id=`${selected.product.id}-${number}`;levels.set(id,1);renderWorld(id);scrollToNode(selected);$('demo-feedback').textContent=`已装配${selected.name}，一级出厂；其他产线规格保留。`;
});
$('build-product').addEventListener('click',()=>{
  if(!layout.next)return;const product=layout.next,index=factoryProducts.findIndex(p=>p.id===product.id);counts[index]=1;const id=`${product.id}-1`;levels.set(id,1);renderWorld(id);scrollToNode(selected);$('demo-feedback').textContent=`${product.zone}首条线和物流已接入。`;
});
$('level-select').addEventListener('change',event=>{
  if(selected?.type!=='line')return;const level=Number(event.target.value);levels.set(selected.id,level);selected.levelElement.textContent=`Lv.${level}`;selected.element.dataset.level=String(level);selected.element.setAttribute('aria-label',`选择${selected.name}，出厂${level}级`);selectNode(selected);$('demo-feedback').textContent=`${selected.name}显示为${level}级，其他产线显示等级保留。`;
});
$('collapse-detail').addEventListener('click',()=>{const collapsed=$('phone').classList.toggle('collapsed');$('collapse-detail').setAttribute('aria-expanded',String(!collapsed));$('collapse-detail').setAttribute('aria-label',collapsed?'展开设备详情':'收起设备详情');if(selected)selectNode(selected);});
$('warehouse-view').addEventListener('click',()=>{selectNode(nodes.get('warehouse'));scrollToNode(selected);});
$('catalog-view').addEventListener('click',()=>{const show=$('catalog').hidden;$('catalog').hidden=!show;$('catalog-view').setAttribute('aria-expanded',String(show));if(show)$('catalog').scrollIntoView({behavior:'smooth',block:'start'});});
window.addEventListener('resize',resizeWorld);

try{
  await Promise.all([...runtimeFactoryAssets,...factoryDecorationAssets,...Object.values(vectors),runtimeFactoryFloor].map(asset=>loadImage(asset.src)));
  const preset=Object.hasOwn(factoryLayoutPresets,params.get('layout'))?params.get('layout'):'six';applyPreset(preset);
  if(params.get('collapsed')==='true')$('collapse-detail').click();
  const position=params.get('position');if(position==='warehouse')$('warehouse-view').click();else if(position&&nodes.has(`${position}-1`)){selectNode(nodes.get(`${position}-1`));scrollToNode(selected);}
  for(const asset of [...Object.values(vectors),...factoryDecorationAssets,...runtimeFactoryAssets,runtimeFactoryFloor]){
    const card=document.createElement('a');card.className='asset-card';card.href=asset.src;card.target='_blank';card.rel='noopener';
    const display=document.createElement('div');display.className='asset-display';const img=document.createElement('img');img.src=asset.src;img.alt=asset.label||asset.id||'运行地面';display.append(img);const title=document.createElement('strong');title.textContent=asset.label||asset.id||'运行地面';card.append(display,title);$('catalog').append(card);
  }
  $('load-status').textContent=`已载入19张核心运行PNG、2张装饰运行PNG、1张运行地面及13个扩展SVG；六代设备与公共物流已装配。`;
  document.documentElement.dataset.ready='true';
}catch(error){$('load-status').textContent=error.message;document.documentElement.dataset.ready='error';console.error(error);}
