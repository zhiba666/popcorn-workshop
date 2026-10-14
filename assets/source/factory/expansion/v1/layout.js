import { assetCatalog } from '../../../../catalog.js';

const productLayouts = {
  original: {zone:'气爆作坊',width:154,terminal:[1019,1117]},
  caramel: {zone:'裹糖工坊',width:154,terminal:[1067,1093]},
  'popcorn-ball': {zone:'成球工坊',width:168,terminal:[866,1083]},
  'crisp-stick': {zone:'脆棒工坊',width:176,terminal:[1091,1025]},
  wafer: {zone:'薄脆工坊',width:178,terminal:[402,1014],frontReturn:true},
  'sandwich-square': {zone:'夹心工坊',width:184,terminal:[152,1014],frontReturn:true},
};

export const factoryProducts = Object.freeze([...assetCatalog.products]
  .sort((a,b)=>a.index-b.index)
  .map(product=>({...product,...productLayouts[product.id]})));

export const factoryLayoutPresets = Object.freeze({opening:[1,1,0,0,0,0],six:[1,1,1,1,1,1],full:[3,3,3,3,3,3]});

// Vertical expansion preserves a phone-sized work area and two separate trunks.
// Coordinates are screen-space installation points, not production timings.
export function buildFactoryExpansionLayout(counts){
  const groups=[],lines=[],slots=[];
  let y=190;
  for(let index=0;index<factoryProducts.length;index++){
    const product=factoryProducts[index],count=counts[index];
    if(!Number.isInteger(count)||count<0||count>3)throw new RangeError('每种产品的装配数量必须为0至3条。');
    if(!count)break;
    const group={product,index,y,count};groups.push(group);y+=44;
    for(let number=1;number<=count;number++){
      lines.push({id:`${product.id}-${number}`,product,number,y,foot:y+163});y+=244;
    }
    if(count<3){slots.push({id:`${product.id}-new`,type:'line-slot',product,number:count+1,y});y+=112;}
    group.bottom=y;y+=22;
  }
  const next=factoryProducts[groups.length];
  if(next){slots.push({id:'next-product',type:'product-slot',product:next,number:1,y});y+=186;}
  const sharedY=y+30;
  return {groups,lines,slots,next,sharedY,height:sharedY+354,supplyTrunkX:43,finishedTrunkX:342};
}
