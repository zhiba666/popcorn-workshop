const base = new URL('./', import.meta.url);
const projection = [1, 0.138, -0.1333333333, 1];
const port = (x, y, tangent) => ({ x, y, tangent });
const logisticsPorts = {
  west: port(8, 42.48, [-1, -0.138]),
  east: port(88, 53.52, [1, 0.138]),
  north: port(53.3333333333, 8, [0.1333333333, -1]),
  south: port(42.6666666667, 88, [-0.1333333333, 1]),
};
const asset = (id, label, width, height, details = {}) => ({
  id, label, src: new URL(`${id}.svg`, base).href,
  size: [width, height], width, height, ...details,
});

export const factoryExpansionAssets = {
  projection,
  palette: { ivory: '#f4e3c4', teal: '#4d7263', brass: '#e3b250' },
  assets: {
    'floor-stone-tile': asset('floor-stone-tile', '扩展石砖地面', 192, 192, {
      anchor: [96, 96], anchors: { center: [96, 96] },
      localBounds: [-80, -64, 160, 128],
      stride: { horizontal: [160, 22.08], vertical: [-17.0666666624, 128] },
    }),
    'floor-transition-h': asset('floor-transition-h', '横向地面过渡条', 256, 96, {
      anchor: [128, 48], anchors: { west: [16, 32.544], east: [240, 63.456] },
      stride: [224, 30.912],
    }),
    'floor-transition-v': asset('floor-transition-v', '纵向地面过渡条', 96, 256, {
      anchor: [48, 128], anchors: { north: [62.9333333296, 16], south: [33.0666666704, 240] },
      stride: [-29.8666666592, 224],
    }),
    'zone-divider-h': asset('zone-divider-h', '横向厂区分隔', 256, 96, {
      anchor: [128, 48], anchors: { west: [16, 32.544], east: [240, 63.456] },
      stride: [224, 30.912], elevation: 4,
    }),
    'zone-divider-v': asset('zone-divider-v', '纵向厂区分隔', 96, 256, {
      anchor: [48, 128], anchors: { north: [62.9333333296, 16], south: [33.0666666704, 240] },
      stride: [-29.8666666592, 224], elevation: 4,
    }),
    'construction-platform': asset('construction-platform', '建设占位地台', 256, 208, {
      anchor: [128, 96], anchors: { center: [128, 96], signFoot: [128, 126] },
      localBounds: [-108, -64, 216, 128], elevation: 7,
    }),
    'expansion-plus-sign': asset('expansion-plus-sign', '扩建入口加号牌', 112, 144, {
      anchor: [56, 132], anchors: { foot: [56, 132], signCenter: [56, 49] },
      hitRect: [11, 9, 90, 81],
    }),
    'branch-sealed-cap': asset('branch-sealed-cap', '未建设支线封帽', 96, 96, {
      anchor: [48, 48], anchors: { west: [8, 42.48], cap: [61.5, 49.863] },
      ports: { west: logisticsPorts.west },
    }),
    'branch-connection-slot': asset('branch-connection-slot', '支线连接插槽', 96, 96, {
      anchor: [48, 48], anchors: { west: [8, 42.48], socket: [64.5, 50.277] },
      ports: { west: logisticsPorts.west },
    }),
    'product-zone-nameplate': asset('product-zone-nameplate', '产品区空白铭牌', 256, 64, {
      anchor: [128, 29], nineSlice: { left: 24, top: 19, right: 24, bottom: 22 },
      contentRect: [28, 15, 200, 28], minSize: [72, 64],
    }),
    'pipe-h': asset('pipe-h', '横向装饰管线', 96, 96, {
      anchor: [48, 48], anchors: { west: [8, 42.48], east: [88, 53.52] },
      ports: { west: logisticsPorts.west, east: logisticsPorts.east },
      stride: [80, 11.04],
    }),
    'pipe-v': asset('pipe-v', '纵向装饰管线', 96, 96, {
      anchor: [48, 48], anchors: { north: [53.3333333333, 8], south: [42.6666666667, 88] },
      ports: { north: logisticsPorts.north, south: logisticsPorts.south },
      stride: [-10.6666666667, 80],
    }),
    'pipe-elbow-ne': asset('pipe-elbow-ne', '北东转角装饰管线', 96, 96, {
      anchor: [48, 48],
      ports: { north: logisticsPorts.north, east: logisticsPorts.east },
    }),
  },
};

export default factoryExpansionAssets;
