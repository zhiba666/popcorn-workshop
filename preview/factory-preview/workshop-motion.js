import {createMachineMotion} from './workshop-machine-motion.js';
import {createSharedMotion} from './workshop-shared-motion.js';
import {createFlowMotion,createWorkshopMotionState} from './workshop-flow-motion.js';

/** One decorative clock for the layout preview; never writes game state. */
export class WorkshopMotion {
  constructor(viewport) {
    this.viewport=viewport;this.generation=0;this.parts=[];this.time=0;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    this.resume=()=>{this.stop();if(!document.hidden)this.start();};
    document.addEventListener('visibilitychange',this.resume);
    this.reduced.addEventListener('change',this.resume);
  }
  async mount(world,layout,nodes) {
    const generation=++this.generation;
    this.stop();this.parts.forEach(part=>part.destroy());this.parts=[];
    this.layout=layout;this.nodes=new Map(nodes);this.time=0;
    this.viewport.dataset.motion='loading';
    const results=await Promise.allSettled([
      createMachineMotion(this.nodes),createSharedMotion(this.nodes),createFlowMotion(world,layout),
    ].map(promise=>promise.then(part=>{if(generation!==this.generation){part.destroy();return null;}return part;})));
    const parts=results.map(result=>result.status==='fulfilled'?result.value:null);
    if(generation!==this.generation){parts.forEach(part=>part?.destroy());return;}
    this.parts=parts.filter(Boolean);[this.machines,this.shared,this.flow]=parts;
    this.viewport.dataset.motion=results.some(result=>result.status==='rejected')?'partial':'ready';
    // Retain the static sprite when any optional animation resource is unavailable.
    if(!document.hidden)this.start();
  }
  setView(state,overview) {
    this.view=state;this.overview=overview;
    if(this.reduced.matches&&this.parts.length)this.draw();
  }
  visibleRect() {
    const state=this.view,zoom=state?.zoom||1;
    if(!state)return {left:0,top:0,right:this.layout.width,bottom:this.layout.height};
    const halfW=this.viewport.clientWidth/2/zoom,halfH=this.viewport.clientHeight/2/zoom;
    return {left:state.x-halfW-32,top:state.y-halfH-32,right:state.x+halfW+32,bottom:state.y+halfH+32};
  }
  draw() {
    if(!this.layout)return;
    const rect=this.visibleRect(),visible=node=>node.left+node.width>=rect.left&&node.left<=rect.right&&node.top+node.height>=rect.top&&node.top<=rect.bottom;
    const reducedMotion=this.reduced.matches,state=createWorkshopMotionState(this.layout,this.time);
    this.machines?.draw(this.time,{lineStates:state.lineStates,overview:this.overview,visible,reducedMotion,zoom:this.view?.zoom||1});
    this.shared?.draw(this.time,state,{visible});
    this.flow?.draw(this.time,state,{overview:this.overview,visibleRect:rect,reducedMotion});
  }
  start() {
    if(!this.parts.length||this.frame||document.hidden)return;
    this.viewport.dataset.motion=this.reduced.matches?'reduced':'running';
    this.draw();if(this.reduced.matches)return;
    this.previous=0;this.lastDraw=0;
    const tick=stamp=>{
      this.frame=0;if(document.hidden)return;
      if(this.previous)this.time+=Math.min(.1,(stamp-this.previous)/1000);
      this.previous=stamp;
      const interval=1000/(this.overview?12:24);
      if(stamp-this.lastDraw>=interval){this.draw();this.lastDraw=stamp-(stamp-this.lastDraw)%interval;}
      this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);
  }
  stop() {cancelAnimationFrame(this.frame);this.frame=0;this.previous=0;}
  destroy() {
    ++this.generation;this.stop();this.parts.forEach(part=>part.destroy());this.parts=[];
    document.removeEventListener('visibilitychange',this.resume);this.reduced.removeEventListener('change',this.resume);
  }
}
