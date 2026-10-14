const root = new URL('../../', import.meta.url);
export const factoryDynamicBitmapAssets = [
  { id:'supply-body-clean',label:'供料干净底图',group:'equipment',version:'v2',type:'png',src:new URL('equipment/v2/supply-body-clean.png',root).href,size:[1199,1312],bounds:[82,65,1114,1255] },
  { id:'packer-body-clean',label:'包装干净底图',group:'equipment',version:'v2',type:'png',src:new URL('equipment/v2/packer-body-clean.png',root).href,size:[1448,1086],bounds:[42,74,1309,1011] },
  { id:'loose-popcorn',label:'基础爆米花物料',group:'materials',version:'v1',type:'png',src:new URL('materials/v1/loose-popcorn.png',root).href,size:[1312,1199],bounds:[215,183,1115,1032] },
  { id:'caramel-popcorn',label:'焦糖半成品物料',group:'materials',version:'v1',type:'png',src:new URL('materials/v1/caramel-popcorn.png',root).href,size:[1312,1199],bounds:[149,106,1182,1115] },
];

// Geometry is calibrated against the v2 body images, in native source pixels.
// A region samples the original PNG at runtime; it does not duplicate bitmap files.
export const factoryAnimationRigs = {
  supply: {
    body:'supply-body-clean',material:'loose-popcorn',
    glass:[[205,372],[810,463],[980,330],[960,521],[739,706],[327,629],[220,530]],
    motor:{asset:'supply-motor-cap',rect:[936,625,169,222],pivot:[1020.5,736],motion:'vibrate'},
    outlet:[410,1050],
  },
  packer: {
    body:'packer-body-clean',head:{asset:'packer-head',rect:[778,464,170,151],travel:57},
    piston:{centerX:863,rodWidth:18,guide:[845,442,36,39],attachmentY:481,topOccluder:[[805,432],[938,418],[944,450],[805,475]]},
    opening:[[650,442],[992,421],[1018,666],[1115,873],[822,925],[625,688]],
    foreground:[[[420,315],[654,339],[628,719],[561,856],[387,806]],[[1020,333],[1234,368],[1252,826],[1115,873],[990,682]],[[794,774],[888,838],[922,934],[782,893]]],
    ports:{input:[110,650],output:[1150,936]},
  },
  buffer: {
    opening:[[228,478],[489,236],[1115,351],[891,645]],
    frontRim:[[122,477],[233,469],[903,646],[1114,352],[1226,355],[970,766],[856,810],[119,582]],
    foreground:[[[118,517],[896,711],[970,761],[935,1090],[154,904]]],
  },
  warehouse: {stockSlots:[[458,570,96,160],[568,597,96,160],[675,617,96,160]]},
};

export const factoryTransportRoutes = {
  supplyToLine: {
    'original-1':[[237,150],[31,150],[31,423],[84,423]],
    'caramel-1':[[237,150],[31,150],[31,878],[84,878]],
  },
  lineToCache: {
    'original-1':[[234,410],[288,437]],
    'caramel-1':[[238,865],[288,892]],
  },
  cacheToPackaging: {
    'original-1':[[288,437],[310,423],[435,423],[435,1230],[224,1230]],
    'caramel-1':[[288,892],[310,878],[435,878],[435,1230],[224,1230]],
  },
  packagingToWarehouse:[[406,1264],[406,1390],[242,1390],[242,1600]],
};

export const factoryMotionVectorAssets = [
  ...['belt-seams-h','belt-seams-v','foreground-rail-h','foreground-rail-v'].map(id=>({id,label:({'belt-seams-h':'横向带面运动层','belt-seams-v':'纵向带面运动层','foreground-rail-h':'横向前景护栏','foreground-rail-v':'纵向前景护栏'})[id],group:'logistics',version:'v2',type:'svg',src:new URL(`logistics/v2/${id}.svg`,root).href,size:[96,96]})),
];
