const root = new URL('./', import.meta.url);
const png = (group, id, label, width, height, bounds, extra = {}) => ({
  id, label, group, type: 'png', src: new URL(`${group}/v1/${id}.png`, root).href,
  size: [width, height], bounds, ...extra,
});

// Pixel coordinates refer to unmodified source images. Bounds exclude faint alpha noise.
export const factoryBitmapAssets = [
  png('equipment', 'supply', '公共供料', 1199, 1312, [84,66,1112,1254], { anchor:[620,1130], ports:{ output:[410,1050] }, material:'基础爆米花' }),
  png('equipment', 'packer', '公共包装', 1448, 1086, [68,76,1303,991], { anchor:[800,900], ports:{ input:[116,651], output:[1141,920] } }),
  png('equipment', 'warehouse', '统一仓储', 1226, 1283, [23,331,1205,961], { anchor:[610,900], slots:{ stock:[400,520,330,300] } }),
  png('equipment', 'buffer-bin', '通用待包箱', 1330, 1182, [108,131,1226,1118], { anchor:[690,1010], slots:{ material:[360,270,600,390] } }),
  png('equipment', 'supply-motor-cap', '供料电机端盖 · 重绘部件', 1299, 1211, [263,173,1073,1044], { partOf:'supply', sourceRegion:[934,627,1107,848], role:'redrawn-component', needsAlignment:false, calibratedAgainst:'supply-body-clean', animationRegion:[936,625,169,222] }),
  png('equipment', 'packer-head', '包装压头 · 重绘部件', 1346, 1169, [362,284,985,908], { partOf:'packer', sourceRegion:[783,453,958,605], role:'redrawn-component', needsAlignment:false, calibratedAgainst:'packer-body-clean', animationRegion:[778,464,170,151] }),
  png('environment', 'floor', '奶油石砖地面', 1536, 1024, [0,0,1536,1024], { opaque:true }),
  png('environment', 'wall-left', '厂房左墙', 853, 1843, [0,0,853,1843]),
  png('environment', 'wall-back', '厂房后墙', 1774, 887, [0,0,1774,887]),
  png('environment', 'platform', '通用石材地台', 1817, 866, [0,0,1817,866]),
];

export const factoryVectorAssets = [
  ...['straight-h','straight-v','corner-ne','corner-nw','corner-se','corner-sw','junction-east','junction-west','end-cap','connector'].map(id=>({ id, group:'logistics',type:'svg',label:({ 'straight-h':'横向传送带','straight-v':'纵向传送带','corner-ne':'右上转角','corner-nw':'左上转角','corner-se':'右下转角','corner-sw':'左下转角','junction-east':'右侧支线接头','junction-west':'左侧汇流接头','end-cap':'端头','connector':'设备连接口' })[id],src:new URL(`logistics/v1/${id}.svg`,root).href,size:[96,96] })),
  ...['panel','order-card','nameplate','button-blue','button-green','button-gold','nav-active','nav-idle','coin','icons'].map(id=>({ id,group:'ui',type:'svg',label:({ panel:'通用面板','order-card':'订单卡','nameplate':'设备铭牌','button-blue':'加速按钮','button-green':'产能按钮','button-gold':'升阶按钮','nav-active':'选中导航','nav-idle':'普通导航',coin:'金币',icons:'操作图标集' })[id],src:new URL(`ui/v1/${id}.svg`,root).href })),
];

export const factoryAssembly = {
  viewport: [390,844], scene: [390,840],
  // Same oblique projection and logistics topology as layout v4, scaled to phone width.
  project(x,y,z=0) { const s=390/744; return [(300+1.45*x-.1*y-242)*s,(230+.2*x+.75*y-182-1.05*z)*s+32]; },
  lineIds: ['original-1','caramel-1'],
};
