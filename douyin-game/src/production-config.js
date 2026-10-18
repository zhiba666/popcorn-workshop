'use strict';

const PRODUCT_DEFINITIONS = Object.freeze({
  original: Object.freeze({ id: 'original', name: '原味', generation: 1, workshopName: '气爆作坊',
    machineId: 'air-popper', machineName: '气爆锅', constructionCost: 0 }),
  caramel: Object.freeze({ id: 'caramel', name: '焦糖', generation: 2, workshopName: '裹糖工坊',
    machineId: 'caramel-drum', machineName: '裹糖滚筒', constructionCost: 180 }),
  'popcorn-ball': Object.freeze({ id: 'popcorn-ball', name: '爆米花球', generation: 3, workshopName: '成球工坊',
    machineId: 'ball-mold-press', machineName: '合模机', constructionCost: 180 }),
  'crisp-stick': Object.freeze({ id: 'crisp-stick', name: '脆棒', generation: 4, workshopName: '脆棒工坊',
    machineId: 'sheeting-strip-cutter', machineName: '压延切条机', constructionCost: 180 }),
  wafer: Object.freeze({ id: 'wafer', name: '薄脆', generation: 5, workshopName: '薄脆工坊',
    machineId: 'flip-wafer-mold', machineName: '双面烤模机', constructionCost: 180 }),
  'sandwich-square': Object.freeze({ id: 'sandwich-square', name: '夹心脆方', generation: 6, workshopName: '夹心工坊',
    machineId: 'rotary-sandwich-assembler', machineName: '旋转组装台', constructionCost: 180 })
});

// Each authored specification describes whole goods. Higher output levels
// need larger material batches once a single good exceeds four base units.
const PRODUCTION_CONFIG = Object.freeze({
  products: Object.freeze(Object.keys(PRODUCT_DEFINITIONS)),
  initialLineIds: Object.freeze(['original-1']),
  lines: Object.freeze([
    Object.freeze({ id: 'original-1', product: 'original', number: 1, launcherCell: 8 }),
    Object.freeze({ id: 'caramel-1', product: 'caramel', number: 1, launcherCell: 12 }),
    Object.freeze({ id: 'popcorn-ball-1', product: 'popcorn-ball', number: 1, launcherCell: 29 }),
    Object.freeze({ id: 'crisp-stick-1', product: 'crisp-stick', number: 1, launcherCell: 33 }),
    Object.freeze({ id: 'wafer-1', product: 'wafer', number: 1, launcherCell: 50 }),
    Object.freeze({ id: 'sandwich-square-1', product: 'sandwich-square', number: 1, launcherCell: 54 }),
    Object.freeze({ id: 'original-2', product: 'original', number: 2 }),
    Object.freeze({ id: 'caramel-2', product: 'caramel', number: 2 }),
    Object.freeze({ id: 'popcorn-ball-2', product: 'popcorn-ball', number: 2 }),
    Object.freeze({ id: 'crisp-stick-2', product: 'crisp-stick', number: 2 }),
    Object.freeze({ id: 'wafer-2', product: 'wafer', number: 2 }),
    Object.freeze({ id: 'sandwich-square-2', product: 'sandwich-square', number: 2 })
  ]),
  maxLinesPerProduct: 2,
  lineExpansionCost: 180,
  productConstructionCost: 180,
  // Stage two retains the original two-product production specifications.
  // Construction supplies the extra public capacity; paid levels multiply it.
  sharedStageMultipliers: Object.freeze({ 1: 2, 2: 1, 3: 2 / 3, 4: 1 / 2, 5: 2 / 5, 6: 1 / 3 }),
  maxCapacityLevel: 2,
  maxOutputLevel: 6,
  maxProductLevel: 10,
  capacityUpgradeCost: 180,
  outputUpgradeCost: 180,
  // Customer visits refill these three slots independently.
  parallelOrderSlots: 3,
  // Default identity for pre-customer saves and callers omitting an ID.
  currentCustomerId: 'rabbit-courier',
  maxSharedLevel: 2,
  sharedUpgradeCost: 180,
  // Trial values for this prototype, not a final economy table.
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
    2: Object.freeze({ batchUnits: 2, unitBaseUnits: 2 }),
    3: Object.freeze({ batchUnits: 1, unitBaseUnits: 4 }),
    4: Object.freeze({ batchUnits: 1, unitBaseUnits: 8 }),
    5: Object.freeze({ batchUnits: 1, unitBaseUnits: 16 }),
    6: Object.freeze({ batchUnits: 1, unitBaseUnits: 32 })
  }),
  phaseDurations: Object.freeze({
    supply: 0.6, feeding: 0.7, discharging: 0.45,
    transport: 0.6, packaging: 0.95, warehouse: 0.7
  }),
  processingSeconds: Object.freeze({ 1: 2, 2: 1 })
});

function outputBatchBaseUnits(outputLevel) {
  const spec = PRODUCTION_CONFIG.outputSpecs[outputLevel];
  return spec.batchUnits * spec.unitBaseUnits;
}

function cacheCapacityBaseUnits(outputLevel) {
  return Math.max(PRODUCTION_CONFIG.cacheCapacityBaseUnits, 2 * outputBatchBaseUnits(outputLevel));
}

function materialSpecification(lines) {
  // Every refill can supply the largest purchased batch. Otherwise lower
  // level lines can consume each small refill before a large batch can start.
  const refillBaseUnits = Math.max(PRODUCTION_CONFIG.materialRefillBaseUnits,
    ...lines.map(line => outputBatchBaseUnits(line.outputLevel)));
  return { refillBaseUnits,
    capacityBaseUnits: Math.max(PRODUCTION_CONFIG.materialCapacityBaseUnits, 2 * refillBaseUnits) };
}

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

// Keep the injection and sealing dwell readable after a speed upgrade.
function processingSeconds(product, capacityLevel, rotaryPasses = 1) {
  const seconds = PRODUCTION_CONFIG.processingSeconds[capacityLevel];
  return product === 'sandwich-square' ?
    Math.max(seconds, 1.5) * rotaryPasses : seconds;
}

function factoryPhaseSeconds(product, factory, phase) {
  const spec = getBatchSpec(product, factory.outputLevel, factory.capacityLevel);
  // An unmarked factory is a legacy batch; finish it at its original speed.
  if (phase !== 'processing' || product !== 'sandwich-square' || factory.rotaryPasses === undefined)
    return spec.phaseDurations[phase];
  return processingSeconds(product, factory.capacityLevel, factory.rotaryPasses);
}

function machineCycleSeconds(product, outputLevel, capacityLevel) {
  const spec = getBatchSpec(product, outputLevel, capacityLevel);
  if (!spec) return null;
  return ['supply', 'feeding', 'processing', 'discharging', 'transport']
    .reduce((sum, phase) => sum + (phase === 'processing' ?
      processingSeconds(product, capacityLevel) : spec.phaseDurations[phase]), 0);
}

module.exports = { PRODUCTION_CONFIG, PRODUCT_DEFINITIONS, getBatchSpec, machineCycleSeconds,
  cacheCapacityBaseUnits, materialSpecification, processingSeconds, factoryPhaseSeconds };
