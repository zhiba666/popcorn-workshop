'use strict';

const { PRODUCTION_CONFIG: CONFIG } = require('./production-config');

// Reuse the expansion preview's vertical product areas and separate trunks.
// Installation coordinates never determine production capacity.
function buildFactoryLayout(lines) {
  const groups = [], scenes = [], slots = [];
  let y = 152;
  for (const product of CONFIG.products) {
    const productLines = lines.filter(line => line.product === product);
    if (!productLines.length) continue;
    groups.push({ product, y, count: productLines.length });
    y += 35;
    for (const line of productLines) {
      scenes.push({ lineId: line.id, product,
        machine: { x: 64, y, w: 145, h: 118 },
        cache: { x: 233, y: y + 77, w: 59, h: 48 },
        hit: { x: 56, y: y - 5, w: 252, h: 166 } });
      y += 182;
    }
    if (productLines.length < CONFIG.maxLinesPerProduct) {
      slots.push({ product, number: productLines.length + 1, x: 64, y, w: 252, h: 80 });
      y += 96;
    }
    y += 22;
  }
  const nextProduct = CONFIG.products.find(product => !lines.some(line => line.product === product));
  const construction = nextProduct ? { product: nextProduct, x: 64, y, w: 252, h: 172 } : null;
  if (construction) y += construction.h + 22;
  return { groups, scenes, slots, construction, supply: { x: 220, y: 10, w: 115, h: 101 },
    packaging: { x: 243, y: y + 28, w: 122, h: 74 },
    warehouse: { x: 55, y: y + 126, w: 176, h: 66 }, height: y + 224 };
}

module.exports = { buildFactoryLayout };
