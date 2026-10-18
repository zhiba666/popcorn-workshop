import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// World coordinates are shared by footprints, equipment and logistics.
const project = (x, y, z = 0) => [300 + 1.45 * x - 0.1 * y, 230 + 0.2 * x + 0.75 * y - 1.05 * z];
const point = p => p.map(n => Math.round(n * 10) / 10).join(',');
const polygon = points => points.map(point).join(' ');
const corners = (x, y, w, d, z = 0) => [[x,y],[x+w,y],[x+w,y+d],[x,y+d]].map(([a,b]) => project(a,b,z));
const parts = [];
const add = svg => parts.push(svg);
const text = (x, y, value, extra = '') => `<text x="${x}" y="${y}" ${extra}>${value}</text>`;

function box(x, y, w, d, h, platform = false) {
  const base = corners(x,y,w,d);
  const top = corners(x,y,w,d,h);
  const line = platform ? '#b7babd' : '#747b80';
  add(`<g stroke="${line}" stroke-width="1.7" stroke-linejoin="round">
    <polygon points="${polygon([base[1],base[2],top[2],top[1]])}" fill="${platform ? '#dce0e1' : '#c4c9cd'}"/>
    <polygon points="${polygon([base[2],base[3],top[3],top[2]])}" fill="${platform ? '#e4e7e8' : '#dadee1'}"/>
    <polygon points="${polygon(top)}" fill="${platform ? '#f0f1f2' : '#f8f9fa'}"/>
  </g>`);
}

function shadow(x,y,w,d) {
  const shape = corners(x,y,w,d).map(([a,b]) => [a+12,b+11]);
  add(`<polygon points="${polygon(shape)}" fill="#424b53" opacity=".075"/>`);
}

function route(points, color, width = 4) {
  const coordinates = points.map(p => project(...p));
  const d = coordinates.map((p,i) => `${i ? 'L' : 'M'} ${point(p)}`).join(' ');
  add(`<path d="${d}" fill="none" stroke="white" stroke-width="${width+5}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
}

function arrow(from, to, color) {
  const a = project(...from), b = project(...to);
  const dx = b[0]-a[0], dy = b[1]-a[1], length = Math.hypot(dx,dy);
  const ux = dx/length, uy = dy/length;
  const vertices = [b, [b[0]-ux*12-uy*5,b[1]-uy*12+ux*5], [b[0]-ux*12+uy*5,b[1]-uy*12-ux*5]];
  add(`<polygon points="${polygon(vertices)}" fill="${color}"/>`);
}

function label(x,y,value,extra='') {
  const p = project(x,y);
  add(text(p[0],p[1],value,`text-anchor="middle" ${extra}`));
}

const blue = '#4d83a8', orange = '#c18b54';
add(`<svg xmlns="http://www.w3.org/2000/svg" width="1220" height="1690" viewBox="0 0 1220 1690">
  <style>text{font-family:'Microsoft YaHei','Noto Sans CJK SC',sans-serif;font-size:23px;fill:#42494e} .small{font-size:18px;fill:#7c848a} .ui{font-size:18px;fill:#92999f} .title{font-size:34px;font-weight:600} .range{font-size:19px;fill:#66809a}</style>
  <rect width="1220" height="1690" fill="#fff"/>
  ${text(80,65,'2.5D 体块布局草稿','class="title"')}
  <path d="M80 101h46" stroke="${blue}" stroke-width="4"/>${text(139,108,'供料','class="small"')}
  <path d="M225 101h46" stroke="${orange}" stroke-width="4"/>${text(284,108,'完成品汇流','class="small"')}
  <polygon points="${polygon(corners(0,0,460,1560))}" fill="#f4f5f5" stroke="#d9dddf" stroke-width="1.8"/>
  <rect x="242" y="182" width="744" height="1022.52" rx="5" fill="none" stroke="#8da4b7" stroke-width="2" stroke-dasharray="10 8"/>
  ${text(999,198,'首屏厂景范围','class="range"')}${text(999,225,'390 × 536','class="small"')}
  ${text(1030,285,'390 × 844','class="small"')}
  <g stroke="#c9cfd3" stroke-width="1.2" fill="none">
    <rect x="1030" y="305" width="130" height="281.33" rx="3"/>
    <path d="M1030 321h130 M1030 350.33h130 M1030 529h130 M1030 567.67h130"/>
  </g>
  <rect x="1030" y="350.33" width="130" height="178.67" fill="#f7f9fb" stroke="#8da4b7" stroke-width="1.5" stroke-dasharray="5 4"/>
  ${text(1013,318,'信息','class="ui" text-anchor="end"')}
  ${text(1013,341,'订单','class="ui" text-anchor="end"')}
  ${text(1013,447,'厂景','class="ui" text-anchor="end"')}
  ${text(1013,552,'详情','class="ui" text-anchor="end"')}
  ${text(1013,585,'导航','class="ui" text-anchor="end"')}
  <path d="M987 355h23" stroke="#8da4b7" stroke-width="1.3" stroke-dasharray="4 4"/>`);

// Dedicated main trunks: no connection from one product to another.
route([[170,122],[31,122],[31,893]], blue);
route([[31,423],[84,423]], blue);
route([[31,878],[84,878]], blue);
route([[228,423],[435,423],[435,1265],[410,1265]], orange);
route([[228,878],[435,878]], orange);
route([[242,1310],[242,1465]], orange);

arrow([115,122],[82,122],blue);
arrow([31,246],[31,282],blue);
arrow([34,423],[53,423],blue);
arrow([31,638],[31,678],blue);
arrow([34,878],[53,878],blue);
arrow([350,423],[390,423],orange);
arrow([435,552],[435,592],orange);
arrow([350,878],[390,878],orange);
arrow([435,1100],[435,1142],orange);
arrow([242,1340],[242,1370],orange);

const equipment = [
  { x:170,y:70,w:95,d:105,h:110, island:[145,48,145,145], name:'公共供料' },
  { x:84,y:345,w:144,d:105,h:82, island:[59,322,194,149], name:'原味 · 1号线' },
  { x:266,y:401,w:44,d:46,h:15, name:'本地待包', smallLabel:true },
  { x:84,y:800,w:144,d:105,h:90, island:[59,777,194,149], name:'焦糖 · 1号线' },
  { x:266,y:856,w:44,d:46,h:15, name:'本地待包', smallLabel:true },
  { x:408,y:990,w:44,d:62,h:15, name:'公共待包' },
  { x:242,y:1200,w:168,d:110,h:76, island:[218,1176,210,155], name:'公共包装' },
  { x:110,y:1465,w:250,d:60,h:50, island:[87,1445,296,100], name:'统一仓储' },
];

equipment.sort((a,b) => project(a.x,a.y)[1] - project(b.x,b.y)[1]);
for (const item of equipment) {
  if(item.island) box(...item.island,8,true);
  shadow(item.x,item.y,item.w,item.d);
  box(item.x,item.y,item.w,item.d,item.h);
  if(item.name==='公共待包') {
    const p=project(item.x+item.w,item.y+15);
    add(`<path d="M${point([p[0]+8,p[1]-8])}h30" stroke="#aeb5b9" stroke-width="1.2"/>`);
    add(text(p[0]+47,p[1]-2,item.name,'class="small"'));
  } else label(item.x+item.w/2,item.y+item.d+(item.smallLabel ? 32 : 52),item.name,item.smallLabel ? 'class="small"' : '');
}

add(`${text(80,1638,'固定斜俯视 · 产线左置 · 灰白体块 · 仅用于空间布局判断','class="small"')}</svg>`);
const svg = parts.join('\n');
const outputDir = fileURLToPath(new URL('../../assets/reference/layouts/factory/v4/',import.meta.url));
mkdirSync(outputDir,{recursive:true});
writeFileSync(`${outputDir}/factory-blockout.svg`,svg);
console.log(`${outputDir}/factory-blockout.svg`);
