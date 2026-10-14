import { MACHINE_RIGS } from '../../assets/source/gameplay/machines/animation/v1/rigs.js';
import { EquipmentRenderer } from '../equipment-preview/renderer.js';
import { factoryAnimationRigs, factoryDynamicBitmapAssets, factoryTransportRoutes, factoryMotionVectorAssets } from '../../assets/source/factory/animation/v1/rigs.js';
import { factoryBitmapAssets, factoryAssembly } from '../../assets/source/factory/manifest.js';
import { factoryStateAssets } from '../../assets/source/factory/states/v1/manifest.js';

const bitmapDefinitions = new Map([...factoryBitmapAssets,...factoryDynamicBitmapAssets].map(asset=>[asset.id,asset]));
const stateLabels = Object.fromEntries(Object.entries(factoryStateAssets.badges).map(([key,asset])=>[key,asset.label]));
const image = src => new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`动画资源未载入：${src.split('/').pop()}`));img.src=src;});
function polygon(ctx,points){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
function bitmap(ctx,resource,rect){const [x0,y0,x1,y1]=resource.definition.bounds;ctx.drawImage(resource.image,x0,y0,x1-x0,y1-y0,...rect);}
function pointAlong(points,progress){const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));let distance=lengths.reduce((sum,x)=>sum+x,0)*Math.max(0,Math.min(1,progress));for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]||i===lengths.length-1){const t=lengths[i]?distance/lengths[i]:0;return[points[i][0]+(points[i+1][0]-points[i][0])*t,points[i][1]+(points[i+1][1]-points[i][1])*t];}distance-=lengths[i];}return points[0];}

function machinePose(rig,line,time){
  const phaseName=line.heldPhase||line.phase;
  const id=({feeding:'feeding',processing:'processing',discharge:'discharging'})[phaseName]||'feeding';
  const phase=rig.phases.find(entry=>entry.id===id);
  const phaseStart=name=>{let seconds=0;for(const entry of rig.phases){if(entry.id===name)return seconds;seconds+=entry.seconds;}return 0;};
  const local=phase.seconds*line.progress;
  return {ready:true,error:'',form:'cycle',inFlight:['feeding','processing','discharge'].includes(line.phase)&&line.status!=='cache-full',hasInput:Boolean(line.batch),elapsed:phaseStart(id)+local,motionTime:time,cycleIndex:line.completed,loopIndex:line.completed,phase:{...phase,elapsed:local,progress:line.progress},phaseStart};
}

export class FactoryAnimationScene {
  constructor(items,beltPieces){this.items=items;this.beltPieces=beltPieces;this.resources=new Map();this.renderers=new Map();this.canvases=new Map();this.badges=new Map();this.lastInterface=-1;}
  async load(){
    const ids=['supply-body-clean','packer-body-clean','supply-motor-cap','packer-head','loose-popcorn','caramel-popcorn','buffer-bin','warehouse'];
    await Promise.all(ids.map(async id=>{const definition=bitmapDefinitions.get(id);this.resources.set(id,{definition,image:await image(definition.src)});}));
    await Promise.all(['original','caramel'].map(async product=>{const src=new URL(`../../assets/source/gameplay/products/v9/${product==='original'?'original':'caramel'}/lv-01.png`,import.meta.url).href;const img=await image(src);this.resources.set(`product-${product}`,{definition:{bounds:[0,0,img.width,img.height]},image:img});}));
    await Promise.all(MACHINE_RIGS.slice(0,2).map(async(rig,index)=>{const renderer=new EquipmentRenderer(rig);await renderer.load();this.renderers.set(index?'caramel-1':'original-1',renderer);}));
    await Promise.all(factoryMotionVectorAssets.map(async asset=>this.resources.set(asset.id,{image:await image(asset.src)})));
    for(const item of this.items){
      const canvas=document.createElement('canvas');canvas.className='animated-sprite';canvas.setAttribute('aria-hidden','true');
      item.element.querySelector('.sprite').replaceChildren(canvas);this.canvases.set(item.id,canvas);
      const badge=document.createElement('img');badge.className='state-badge';badge.alt='';badge.setAttribute('aria-hidden','true');item.element.querySelector('.nameplate .dot')?.remove();item.element.querySelector('.nameplate').prepend(badge);this.badges.set(item.id,badge);
      const track=document.createElement('span');track.className='device-progress';const fill=document.createElement('i');track.append(fill);item.element.append(track);item.progressFill=fill;
      const shadow=document.createElement('img');shadow.src=factoryStateAssets['contact-shadow'].src;shadow.className='contact-shadow';shadow.alt='';item.element.prepend(shadow);
      const ring=item.element.querySelector('.selection');ring.style.backgroundImage=`url("${factoryStateAssets['selection-ring'].src}")`;
    }
    const canvas=document.createElement('canvas');canvas.className='transport-motion';canvas.width=780;canvas.height=1680;canvas.setAttribute('aria-hidden','true');document.getElementById('world').append(canvas);this.transport=canvas;
  }

  _context(item){
    const canvas=this.canvases.get(item.id),w=item.element.offsetWidth,h=item.element.offsetHeight,dpr=Math.min(devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const [x0,y0,x1]=item.sprite.bounds;const scale=w/(x1-x0);ctx.scale(scale,scale);ctx.translate(-x0,-y0);return ctx;
  }

  _supply(ctx,snapshot){
    const rig=factoryAnimationRigs.supply,body=this.resources.get(rig.body),grain=this.resources.get(rig.material);
    ctx.save();polygon(ctx,rig.glass);ctx.clip();
    const count=Math.round(snapshot.supply.units/snapshot.supply.capacity*42);
    for(let i=0;i<count;i++){const row=Math.floor(i/7),col=i%7;const x=260+col*94+(row%2)*28+Math.sin(i*4.3)*12,y=621-row*55+col*17+Math.cos(i*3.7)*11;ctx.save();ctx.translate(x,y);ctx.rotate((i%5-2)*.18);bitmap(ctx,grain,[-52,-47,104,95]);ctx.restore();}
    ctx.restore();ctx.drawImage(body.image,0,0);
    const [x,y,w,h]=rig.motor.rect;
    const running=snapshot.supply.refillEnabled&&snapshot.supply.units<snapshot.supply.capacity;
    const vibrate=running?Math.sin(snapshot.time*22)*1.6:0;
    bitmap(ctx,this.resources.get(rig.motor.asset),[x+vibrate,y,w,h]);
  }

  _packer(ctx,snapshot){
    const rig=factoryAnimationRigs.packer,body=this.resources.get(rig.body),state=snapshot.packaging;
    ctx.drawImage(body.image,0,0);
    ctx.save();polygon(ctx,rig.opening);ctx.clip();
    if(state.phase==='packaging'&&state.batch){
      const resource=this.resources.get(`product-${state.batch.product}`);
      ctx.save();ctx.globalAlpha=.4+.6*state.progress;bitmap(ctx,resource,[785,640,150,168]);ctx.restore();
    }
    const stroke=state.phase==='packaging'?Math.sin(Math.PI*state.progress)**2*rig.head.travel:0;
    const piston=rig.piston,[gx,gy,gw,gh]=piston.guide,rodX=piston.centerX-piston.rodWidth/2;
    const metal=ctx.createLinearGradient(rodX,0,rodX+piston.rodWidth,0);
    metal.addColorStop(0,'#526b70');metal.addColorStop(.25,'#d8e8de');metal.addColorStop(.45,'#fafae8');metal.addColorStop(.7,'#89a5a3');metal.addColorStop(1,'#52696c');
    ctx.fillStyle=metal;ctx.beginPath();ctx.roundRect(rodX,gy+gh-6,piston.rodWidth,piston.attachmentY+stroke-(gy+gh-6),5);ctx.fill();
    const guide=ctx.createLinearGradient(gx,0,gx+gw,0);
    guide.addColorStop(0,'#986621');guide.addColorStop(.3,'#f9d374');guide.addColorStop(.5,'#ffe6a2');guide.addColorStop(1,'#a97026');
    ctx.fillStyle=guide;ctx.strokeStyle='#765326';ctx.lineWidth=1.8;ctx.beginPath();ctx.roundRect(gx,gy,gw,gh,6);ctx.fill();ctx.stroke();
    ctx.fillStyle='#b47a2b';ctx.beginPath();ctx.ellipse(piston.centerX,gy+gh-3,gw/2-2,3.5,0,0,Math.PI*2);ctx.fill();
    ctx.save();polygon(ctx,piston.topOccluder);ctx.clip();ctx.drawImage(body.image,0,0);ctx.restore();
    const [x,y,w,h]=rig.head.rect;bitmap(ctx,this.resources.get(rig.head.asset),[x,y+stroke,w,h]);ctx.restore();
    for(const region of rig.foreground){ctx.save();polygon(ctx,region);ctx.clip();ctx.drawImage(body.image,0,0);ctx.restore();}
  }

  _buffer(ctx,item,snapshot){
    const base=this.resources.get('buffer-bin'),rig=factoryAnimationRigs.buffer;
    const line=snapshot.lines.find(entry=>entry.id===(item.id==='original-buffer'?'original-1':'caramel-1'));
    const batches=item.id==='public-buffer'?snapshot.packaging.queue:line.cache.batches;
    ctx.drawImage(base.image,0,0);ctx.save();polygon(ctx,rig.opening);ctx.clip();
    const count=Math.min(20,batches.length*5);
    for(let i=0;i<count;i++){const batch=batches[Math.floor(i/5)%batches.length],grain=this.resources.get(batch.product==='caramel'?'caramel-popcorn':'loose-popcorn');const row=Math.floor(i/3),col=i%3;const x=440+col*160+(row%2)*32,y=542-row*76+col*28;bitmap(ctx,grain,[x-94,y-90,188,180]);}
    ctx.restore();for(const region of [rig.frontRim,...rig.foreground]){ctx.save();polygon(ctx,region);ctx.clip();ctx.drawImage(base.image,0,0);ctx.restore();}
  }

  _warehouse(ctx,snapshot){
    const base=this.resources.get('warehouse');ctx.drawImage(base.image,0,0);
    const productList=[];for(const product of ['original','caramel'])for(let n=0;n<Math.min(3,snapshot.inventory[product]);n++)productList.push(product);
    for(let i=0;i<Math.min(6,productList.length);i++){const slot=factoryAnimationRigs.warehouse.stockSlots[i%3];const [x,y,w,h]=slot;bitmap(ctx,this.resources.get(`product-${productList[i]}`),[x,y-Math.floor(i/3)*100,w,h]);}
  }

  _belts(ctx,snapshot){
    const elapsed=this.lastBeltTime===undefined?snapshot.time:snapshot.time-this.lastBeltTime;
    this.lastBeltTime=snapshot.time;
    const activeRoutes=snapshot.transfers.filter(transfer=>transfer.kind!=='lineToCache'||snapshot.lines.find(line=>line.id===transfer.lineId).phase!=='waitingPackaging').map(transfer=>{
      const points=transfer.kind==='packagingToWarehouse'?factoryTransportRoutes.packagingToWarehouse:factoryTransportRoutes[transfer.kind]?.[transfer.lineId];
      return points?.map(point=>factoryAssembly.project(...point));
    }).filter(Boolean);
    for(const piece of this.beltPieces){
      if(elapsed<0)piece.motionTime=0;
      const moving=activeRoutes.some(points=>points.slice(1).some((end,index)=>{
        const start=points[index],dx=end[0]-start[0],dy=end[1]-start[1],lengthSquared=dx*dx+dy*dy;
        const t=lengthSquared?Math.max(0,Math.min(1,((piece.center[0]-start[0])*dx+(piece.center[1]-start[1])*dy)/lengthSquared)):0;
        return Math.hypot(piece.center[0]-start[0]-t*dx,piece.center[1]-start[1]-t*dy)<1;
      }));
      if(moving)piece.motionTime+=Math.max(0,elapsed);
      const shift=(piece.motionTime*18)%16*piece.direction;
      ctx.save();ctx.translate(...piece.center);ctx.transform(...piece.matrix,0,0);
      const m=(x,y)=>[x-.1333333333*y,.138*x+y];
      const corners=piece.horizontal?[m(-40,-10.5),m(40,-10.5),m(40,10.5),m(-40,10.5)]:[m(-10.5,-40),m(10.5,-40),m(10.5,40),m(-10.5,40)];polygon(ctx,corners);ctx.clip();
      const img=this.resources.get(`belt-seams-${piece.horizontal?'h':'v'}`).image;
      for(const repeat of [-80,0,80]){const travel=shift+repeat;ctx.drawImage(img,-48+(piece.horizontal?travel:-.1333333333*travel),-48+(piece.horizontal?.138*travel:travel),96,96);}
      ctx.restore();
    }
  }

  _transport(snapshot){
    const ctx=this.transport.getContext('2d');ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,390,840);this._belts(ctx,snapshot);
    for(const transfer of snapshot.transfers){
      const worldPoints=transfer.kind==='packagingToWarehouse'?factoryTransportRoutes.packagingToWarehouse:factoryTransportRoutes[transfer.kind]?.[transfer.lineId];
      if(!worldPoints)continue;
      const points=worldPoints.map(point=>factoryAssembly.project(...point)),[x,y]=pointAlong(points,transfer.progress);
      const packaged=transfer.kind==='packagingToWarehouse';
      const resource=this.resources.get(packaged?`product-${transfer.product}`:transfer.kind==='supplyToLine'||transfer.product==='original'?'loose-popcorn':'caramel-popcorn');
      ctx.save();ctx.globalAlpha=.16;ctx.fillStyle='#69512d';ctx.beginPath();ctx.ellipse(x+1,y+3,packaged?7:4,2,0,0,Math.PI*2);ctx.fill();ctx.restore();
      const w=packaged?21:10,h=packaged?23:9;bitmap(ctx,resource,[x-w/2,y-h/2-2,w,h]);
    }
  }

  draw(snapshot){
    const viewport=document.getElementById('scene-viewport'),scale=viewport.clientWidth/factoryAssembly.viewport[0];
    for(const item of this.items){
      if((item.element.offsetTop+item.element.offsetHeight)*scale<viewport.scrollTop-20||item.element.offsetTop*scale>viewport.scrollTop+viewport.clientHeight+20)continue;
      const ctx=this._context(item);
      if(item.id==='supply')this._supply(ctx,snapshot);
      else if(item.id==='packer')this._packer(ctx,snapshot);
      else if(item.id==='warehouse')this._warehouse(ctx,snapshot);
      else if(item.small)this._buffer(ctx,item,snapshot);
      else{
        const renderer=this.renderers.get(item.id),line=snapshot.lines.find(entry=>entry.id===item.id),pose=machinePose(renderer.rig,line,snapshot.time);
        ctx.drawImage(renderer.base,0,0);for(const layer of renderer.layers)renderer.drawLayer(ctx,layer,pose);
      }
    }
    this._transport(snapshot);
    if(snapshot.time-this.lastInterface>=.1||this.lastInterface<0){this.lastInterface=snapshot.time;this.updateInterface(snapshot);}
  }

  updateInterface(snapshot){
    for(const item of this.items){
      const line=snapshot.lines.find(entry=>entry.id===item.id);
      let status='ready',progress=0;
      if(line){status=line.status;progress=line.progress;}
      else if(item.id==='supply'){status=!snapshot.supply.units?'shortage':snapshot.supply.units<snapshot.supply.capacity?'processing':'ready';progress=snapshot.supply.progress;}
      else if(item.id==='packer'){status=snapshot.packaging.status;progress=snapshot.packaging.progress;}
      else if(item.small){const count=item.id==='public-buffer'?snapshot.packaging.occupiedCount:snapshot.lines.find(entry=>entry.id===(item.id==='original-buffer'?'original-1':'caramel-1')).cache.count;const capacity=item.id==='public-buffer'?snapshot.packaging.queueCapacity:snapshot.rules.cacheCapacity;status=count>=capacity?'cache-full':count?'waiting-pack':'ready';}
      const asset=factoryStateAssets.badges[status],badge=this.badges.get(item.id);if(badge.dataset.state!==status){badge.src=asset.src;badge.dataset.state=status;}
      const label=!item.small&&item.id!=='warehouse'?stateLabels[status]:status==='ready'?item.id==='warehouse'?'库存展示':'空缓存':stateLabels[status];
      item.element.dataset.status=status;item.element.setAttribute('aria-label',`选择${item.name}，${label}`);
      item.progressFill.style.width=`${Math.round(progress*100)}%`;item.progressFill.parentElement.hidden=line?!['feeding','processing','discharge'].includes(line.phase):item.id==='supply'?!snapshot.supply.accelerate.enabled:item.id==='packer'?snapshot.packaging.phase==='ready':true;
    }
  }
}

export function selectedDeviceState(item,snapshot){
  const line=snapshot.lines.find(entry=>entry.id===item.id);
  if(line)return{status:line.status==='cache-full'?stateLabels[line.status]:({feeding:'进料中',processing:'加工中',discharge:'出料中'})[line.phase]||stateLabels[line.status],progress:line.progress,summary:`库存 ${line.inventory}`,accelerate:line.accelerate};
  if(item.id==='supply')return{status:snapshot.supply.units===snapshot.supply.capacity?'供料就绪':snapshot.supply.units?'供料中':'缺料',progress:snapshot.supply.progress,summary:`原料 ${snapshot.supply.units}/${snapshot.supply.capacity}`,accelerate:snapshot.supply.accelerate};
  if(item.id==='packer')return{status:snapshot.packaging.phase==='productTransfer'?'成品转运':snapshot.packaging.phase==='packaging'?'包装中':stateLabels[snapshot.packaging.status],progress:snapshot.packaging.progress,summary:`待包 ${snapshot.packaging.occupiedCount}/${snapshot.packaging.queueCapacity}`,summaryDetail:`已到达 ${snapshot.packaging.queue.length} 批，在途占位 ${snapshot.packaging.inboundCount} 批`,accelerate:snapshot.packaging.accelerate};
  if(item.id==='warehouse')return{status:`原味 ${snapshot.inventory.original}`,progress:null,summary:`焦糖 ${snapshot.inventory.caramel}`,accelerate:null};
  const cache=item.id==='public-buffer'?{count:snapshot.packaging.occupiedCount,capacity:snapshot.packaging.queueCapacity}:snapshot.lines.find(entry=>entry.id===(item.id==='original-buffer'?'original-1':'caramel-1')).cache;
  return{status:cache.count>=cache.capacity?'缓存满':cache.count?'等待包装':'空缓存',progress:null,summary:`缓存 ${cache.count}/${cache.capacity}`,summaryDetail:item.id==='public-buffer'?`已到达 ${snapshot.packaging.queue.length} 批，在途占位 ${snapshot.packaging.inboundCount} 批`:'',accelerate:null};
}
