'use strict';

// Only the two playable products and their existing upgrade levels are open.
// Each authored specification describes whole goods, rather than fractions of
// a fixed material batch. Future levels need an explicit specification here.
const PRODUCTION_CONFIG = Object.freeze({
  products: Object.freeze(['original', 'caramel']),
  initialLineIds: Object.freeze(['original-1', 'caramel-1']),
  lines: Object.freeze([
    Object.freeze({ id: 'original-1', product: 'original', number: 1, launcherCell: 8 }),
    Object.freeze({ id: 'caramel-1', product: 'caramel', number: 1, launcherCell: 12 }),
    Object.freeze({ id: 'original-2', product: 'original', number: 2 }),
    Object.freeze({ id: 'caramel-2', product: 'caramel', number: 2 })
  ]),
  maxLinesPerProduct: 2,
  lineExpansionCost: 180,
  maxCapacityLevel: 2,
  maxOutputLevel: 2,
  maxProductLevel: 5,
  capacityUpgradeCost: 180,
  outputUpgradeCost: 180,
  // Three slots are a trial configuration while the customer design evolves.
  parallelOrderSlots: 3,
  currentCustomerId: 'rabbit-courier',
  maxSharedLevel: 2,
  sharedUpgradeCost: 180,
  // Trial values for this two-product prototype, not a final economy table.
  sharedServiceSpecs: Object.freeze({
    supply: Object.freeze({
      1: Object.freeze({ refillSeconds: 2.2, serviceSeconds: 0.6 }),
      2: Object.freeze({ refillSeconds: 1.1, serviceSeconds: 0.3 })
    }),
    packaging: Object.freeze({
      1: Object.freeze({ serviceSeconds: 0.95 }),
      2: Object.freeze({ serviceSeconds: 0.475 })
    })
  }),
  cacheCapacityBaseUnits: 8,
  materialCapacityBaseUnits: 8,
  materialRefillBaseUnits: 4,
  materialRefillSeconds: 2.2,
  offlineLimitSeconds: 2 * 60 * 60,
  accelerateSeconds: 0.65,
  outputSpecs: Object.freeze({
    1: Object.freeze({ batchUnits: 4, unitBaseUnits: 1 }),
    2: Object.freeze({ batchUnits: 2, unitBaseUnits: 2 })
  }),
  phaseDurations: Object.freeze({
    supply: 0.6, feeding: 0.7, discharging: 0.45,
    transport: 0.6, packaging: 0.95, warehouse: 0.7
  }),
  processingSeconds: Object.freeze({ 1: 2, 2: 1 })
});

function getBatchSpec(product, outputLevel, capacityLevel) {
  const output = PRODUCTION_CONFIG.outputSpecs[outputLevel];
  const processing = PRODUCTION_CONFIG.processingSeconds[capacityLevel];
  if (!PRODUCTION_CONFIG.products.includes(product) || !output || !processing) return null;
  return {
    batchUnits: output.batchUnits,
    unitBaseUnits: output.unitBaseUnits,
    baseUnits: output.batchUnits * output.unitBaseUnits,
    phaseDurations: { ...PRODUCTION_CONFIG.phaseDurations, processing }
  };
}

function machineCycleSeconds(product, outputLevel, capacityLevel) {
  const spec = getBatchSpec(product, outputLevel, capacityLevel);
  if (!spec) return null;
  return ['supply', 'feeding', 'processing', 'discharging', 'transport']
    .reduce((sum, phase) => sum + spec.phaseDurations[phase], 0);
}

module.exports = { PRODUCTION_CONFIG, getBatchSpec, machineCycleSeconds };
