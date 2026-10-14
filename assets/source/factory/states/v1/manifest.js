const base = new URL('./', import.meta.url);
const asset = (id, width, height, extra = {}) => ({
  id, src: new URL(`${id}.svg`, base).href, width, height, ...extra,
});

export const factoryStateAssets = {
  badges: {
    ready: asset('ready', 32, 32, { shape: 'circle', symbol: 'check', label: '可生产' }),
    processing: asset('processing', 32, 32, { shape: 'rounded-square', symbol: 'play', label: '加工中' }),
    shortage: asset('shortage', 32, 32, { shape: 'triangle', symbol: 'exclamation', label: '缺料' }),
    'waiting-pack': asset('waiting-pack', 32, 32, { shape: 'diamond', symbol: 'hourglass', label: '等待包装' }),
    'cache-full': asset('cache-full', 32, 32, { shape: 'octagon', symbol: 'pause', label: '缓存满' }),
  },
  'selection-ring': asset('selection-ring', 240, 100, { anchor: [120, 50], layer: 'below-machine', inset: [10, 11, 10, 11] }),
  'contact-shadow': asset('contact-shadow', 240, 100, { anchor: [120, 50], layer: 'ground' }),
  'progress-track': asset('progress-track', 240, 20, { contentRect: [4, 4, 232, 10], nineSlice: [10, 8, 10, 8] }),
  'progress-fill': asset('progress-fill', 232, 10, { clipDirection: 'left-to-right', roundEnds: true, nineSlice: [5, 5, 5, 5] }),
};

export default factoryStateAssets;
