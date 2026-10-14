'use strict';

const { PRODUCTION_CONFIG: CONFIG, getBatchSpec, machineCycleSeconds } = require('./production-config');
const PRODUCTS = CONFIG.products;
const LINE_IDS = Object.freeze(CONFIG.lines.map(line => line.id));
const LEGACY_LINE_IDS = Object.freeze(['original-1', 'caramel-1']);
const MAIN_PHASES = Object.freeze(['supply', 'feeding', 'processing', 'discharging', 'transport']);
const FACTORY_PHASES = Object.freeze(['waiting-supply', ...MAIN_PHASES, 'waiting-cache']);
// These exact durations remain solely for validating saves written by v1–v4.
const LEGACY_ACTIVE_PHASES = Object.freeze([
  'supply', 'feeding', 'processing', 'discharging',
  'transport', 'packaging', 'warehouse'
]);
const LEGACY_PHASES = Object.freeze(['waiting-supply', ...LEGACY_ACTIVE_PHASES, 'waiting-packaging']);
const LEGACY_PHASE_DURATIONS = Object.freeze({
  'waiting-supply': 0, supply: 0.6, feeding: 0.7, processing: 2,
  discharging: 0.45, transport: 0.6, 'waiting-packaging': 0,
  packaging: 0.95, warehouse: 0.7
});
const LEGACY_CAPACITY = Object.freeze({
  1: Object.freeze({ cycleSeconds: 6, processingSeconds: 2 }),
  2: Object.freeze({ cycleSeconds: 5, processingSeconds: 1 })
});
const LEGACY_MATERIAL_CAPACITY = 8;
const LEGACY_MATERIAL_REFILL_SECONDS = 2.2;
const EPSILON = 1e-9;
const RULES = Object.freeze({
  columns: 7, rows: 9, boardSize: 63, maxLevel: CONFIG.maxProductLevel,
  maxOutputLevel: CONFIG.maxOutputLevel, batchUnits: CONFIG.outputSpecs[1].batchUnits,
  orderLevel: 3, orderReward: 60, phases: FACTORY_PHASES,
  phaseDurations: Object.freeze({ ...CONFIG.phaseDurations, processing: CONFIG.processingSeconds[1],
    'waiting-supply': 0, 'waiting-cache': 0 }), products: PRODUCTS, lineIds: LINE_IDS
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isCell(value) {
  return Number.isInteger(value) && value >= 0 && value < RULES.boardSize;
}

function isCapacityLevel(value) {
  return Number.isInteger(value) && value >= 1 && value <= CONFIG.maxCapacityLevel;
}

function isOutputLevel(value) {
  return Number.isInteger(value) && value >= 1 && value <= CONFIG.maxOutputLevel;
}

function baseUnits(level) {
  return 2 ** (level - 1);
}

function batchUnits(level) {
  return CONFIG.outputSpecs[level].batchUnits;
}

function sharedSpec(service, level) {
  if (!['supply', 'packaging'].includes(service) || !Number.isInteger(level) ||
      level < 1 || level > CONFIG.maxSharedLevel) return null;
  return CONFIG.sharedServiceSpecs[service][level] || null;
}

function validSharedDuration(service, level, duration, key = 'serviceSeconds') {
  for (let candidate = 1; candidate <= level; candidate++) {
    if (sharedSpec(service, candidate)[key] === duration) return true;
  }
  return false;
}

function legacyPhaseDuration(phase, capacityLevel) {
  return phase === 'processing' ? LEGACY_CAPACITY[capacityLevel].processingSeconds : LEGACY_PHASE_DURATIONS[phase];
}

function createLegacyFactory(capacityLevel = 1, outputLevel = 1) {
  return {
    phase: 'waiting-supply', elapsed: 0, duration: 0,
    batchUnits: batchUnits(outputLevel), capacityLevel, outputLevel
  };
}

function createLegacyLine(product) {
  return {
    id: `${product}-1`, product, outputLevel: 1, inventory: 0,
    capacityLevel: 1, discardedBaseUnits: 0, factory: createLegacyFactory()
  };
}

function createLegacyShared() {
  return {
    materials: {
      baseUnits: 4, capacityBaseUnits: LEGACY_MATERIAL_CAPACITY, elapsed: 0,
      duration: LEGACY_MATERIAL_REFILL_SECONDS, refillBaseUnits: RULES.batchUnits
    },
    supply: { lineId: null, elapsed: 0, duration: LEGACY_PHASE_DURATIONS.supply, queue: [...LEGACY_LINE_IDS] },
    packaging: { lineId: null, elapsed: 0, duration: LEGACY_PHASE_DURATIONS.packaging, queue: [] }
  };
}

function makeOrder(id, lines, quick = false) {
  const opening = [
    { products: ['original'], level: 3, reward: 60 },
    { products: ['caramel'], level: 3, reward: 70 },
    { products: PRODUCTS, level: 3, reward: 150 }
  ];
  const cycle = [
    { products: ['original'], level: 4, reward: 110 },
    { products: ['caramel'], level: 4, reward: 120 },
    { products: PRODUCTS, level: 4, reward: 240 },
    { products: ['original'], level: 5, reward: 180 },
    { products: ['caramel'], level: 5, reward: 190 },
    { products: PRODUCTS, level: 5, reward: 380 }
  ];
  const quickProduct = PRODUCTS[(id - 1) % PRODUCTS.length];
  const spec = quick ? opening.find(candidate => candidate.products.length === 1 && candidate.products[0] === quickProduct) :
    id <= opening.length ? opening[id - 1] : cycle[(id - opening.length - 1) % cycle.length];
  return {
    id,
    requirements: spec.products.map(product => ({
      product, level: Math.max(spec.level, Math.min(...lines.filter(line => line.product === product).map(line => line.outputLevel)))
    })),
    reward: spec.reward
  };
}

function hasQuickOrder(orders) {
  return orders.some(order => order.requirements.length === 1 && order.requirements[0].level === 3);
}

function createOrderBook(order, lines, completedOrders) {
  const orders = [order];
  let nextOrderId = order.id + 1;
  while (orders.length < CONFIG.parallelOrderSlots) {
    orders.push(makeOrder(nextOrderId++, lines, !hasQuickOrder(orders)));
  }
  return { orders, focusedOrderId: order.id, nextOrderId, order,
    customerServiceCounts: { [CONFIG.currentCustomerId]: completedOrders } };
}

function restoreOrder(saved, lines) {
  if (!isRecord(saved) || !isId(saved.id) || !isId(saved.reward) ||
      !Array.isArray(saved.requirements) || !saved.requirements.length || saved.requirements.length > PRODUCTS.length) return null;
  const requirements = [];
  for (const requirement of saved.requirements) {
    if (!isRecord(requirement)) return null;
    const productLines = lines.filter(line => line.product === requirement.product);
    if (!productLines.length || requirements.some(other => other.product === requirement.product) ||
        !Number.isInteger(requirement.level) || requirement.level > RULES.maxLevel ||
        requirement.level < Math.min(...productLines.map(line => line.outputLevel))) return null;
    requirements.push({ product: requirement.product, level: requirement.level });
  }
  return { id: saved.id, reward: saved.reward, requirements };
}

function sameOrder(left, right) {
  return left.id === right.id && left.reward === right.reward && left.requirements.length === right.requirements.length &&
    left.requirements.every((requirement, index) => requirement.product === right.requirements[index].product &&
      requirement.level === right.requirements[index].level);
}

function restoreFactory(saved, capacityLevel, outputLevel, legacyVersion) {
  if (!isRecord(saved) || !(legacyVersion ? LEGACY_ACTIVE_PHASES : LEGACY_PHASES).includes(saved.phase)) return null;
  const batchCapacity = legacyVersion === 1 ? 1 : saved.capacityLevel;
  const batchOutput = legacyVersion && legacyVersion < 3 ? 1 : saved.outputLevel;
  const waiting = saved.phase === 'waiting-supply' || saved.phase === 'waiting-packaging';
  if (!isCapacityLevel(batchCapacity) || batchCapacity > capacityLevel ||
      !isOutputLevel(batchOutput) || batchOutput > outputLevel ||
      saved.batchUnits !== batchUnits(batchOutput) ||
      saved.duration !== legacyPhaseDuration(saved.phase, batchCapacity) ||
      !Number.isFinite(saved.elapsed) || saved.elapsed < 0 ||
      (waiting ? saved.elapsed !== 0 : saved.elapsed >= saved.duration)) return null;
  return {
    phase: saved.phase, elapsed: saved.elapsed, duration: saved.duration,
    batchUnits: saved.batchUnits, capacityLevel: batchCapacity, outputLevel: batchOutput
  };
}

function restoreBoard(saved, lines) {
  if (!Array.isArray(saved) || saved.length !== RULES.boardSize) return null;
  const ids = new Set();
  const launchers = new Set();
  const board = [];
  let largestId = 0;
  for (const item of saved) {
    if (item === null) {
      board.push(null);
      continue;
    }
    if (!isRecord(item) || !isId(item.id) || ids.has(item.id) ||
        !PRODUCTS.includes(item.product) || !Number.isInteger(item.level) ||
        item.level < 1 || item.level > RULES.maxLevel) return null;
    ids.add(item.id);
    largestId = Math.max(largestId, item.id);
    if (item.kind === 'product' && lines.some(line => line.product === item.product)) {
      board.push({ kind: 'product', product: item.product, level: item.level, id: item.id });
    } else if (item.kind === 'launcher') {
      const line = lines.find(candidate => candidate.id === item.lineId);
      if (!line || launchers.has(line.id) || item.product !== line.product || item.level !== line.outputLevel) return null;
      launchers.add(line.id);
      board.push({ kind: 'launcher', lineId: line.id, product: line.product, level: item.level, id: item.id });
    } else {
      return null;
    }
  }
  if (launchers.size !== lines.length) return null;
  return { board, largestId };
}

function restoreShared(saved, lines) {
  if (!isRecord(saved) || !isRecord(saved.materials)) return null;
  const material = saved.materials;
  if (!isCount(material.baseUnits) || material.baseUnits > LEGACY_MATERIAL_CAPACITY ||
      material.capacityBaseUnits !== LEGACY_MATERIAL_CAPACITY || material.duration !== LEGACY_MATERIAL_REFILL_SECONDS ||
      material.refillBaseUnits !== RULES.batchUnits || !Number.isFinite(material.elapsed) ||
      material.elapsed < 0 || material.elapsed >= material.duration ||
      (material.baseUnits === LEGACY_MATERIAL_CAPACITY && material.elapsed !== 0)) return null;
  const shared = {
    materials: {
      baseUnits: material.baseUnits, capacityBaseUnits: LEGACY_MATERIAL_CAPACITY,
      elapsed: material.elapsed, duration: LEGACY_MATERIAL_REFILL_SECONDS, refillBaseUnits: RULES.batchUnits
    }
  };
  for (const serviceName of ['supply', 'packaging']) {
    const service = saved[serviceName];
    if (!isRecord(service) || service.duration !== LEGACY_PHASE_DURATIONS[serviceName] ||
        !Number.isFinite(service.elapsed) || service.elapsed < 0 ||
        service.elapsed >= service.duration || !Array.isArray(service.queue) ||
        service.queue.length > lines.length || new Set(service.queue).size !== service.queue.length ||
        service.queue.some(id => !LEGACY_LINE_IDS.includes(id)) ||
        (service.lineId !== null && !LEGACY_LINE_IDS.includes(service.lineId))) return null;
    const active = lines.filter(line => line.factory.phase === serviceName);
    const waiting = lines.filter(line => line.factory.phase === `waiting-${serviceName}`);
    if (active.length > 1 || (active.length ? service.lineId !== active[0].id : service.lineId !== null) ||
        (active.length ? service.elapsed !== active[0].factory.elapsed : service.elapsed !== 0) ||
        waiting.length !== service.queue.length || waiting.some(line => !service.queue.includes(line.id))) return null;
    shared[serviceName] = {
      lineId: service.lineId, elapsed: service.elapsed,
      duration: service.duration, queue: [...service.queue]
    };
  }
  return shared;
}

// Restore only known fields; a corrupt save stays protected by recoveryRequired.
function restoreLegacyState(saved) {
  if (!isRecord(saved) || ![1, 2, 3, 4].includes(saved.schemaVersion) ||
      !isCount(saved.coins) || !isCount(saved.completedOrders) ||
      !['board', 'factory'].includes(saved.page) || !isCell(saved.selectedCell) ||
      !isId(saved.nextItemId) || !isRecord(saved.order) ||
      !isId(saved.order.id) || saved.order.id !== saved.completedOrders + 1) return null;
  if (saved.schemaVersion < 4) return migrateLegacy(saved);
  if (!Array.isArray(saved.lines) || saved.lines.length !== PRODUCTS.length ||
      !LEGACY_LINE_IDS.includes(saved.selectedLineId)) return null;
  const lines = [];
  for (let index = 0; index < PRODUCTS.length; index += 1) {
    const line = saved.lines[index];
    if (!isRecord(line) || line.id !== LEGACY_LINE_IDS[index] || line.product !== PRODUCTS[index] ||
        !isOutputLevel(line.outputLevel) || !isCapacityLevel(line.capacityLevel) ||
        !isCount(line.inventory) || !isCount(line.discardedBaseUnits)) return null;
    const factory = restoreFactory(line.factory, line.capacityLevel, line.outputLevel);
    if (!factory) return null;
    lines.push({
      id: line.id, product: line.product, outputLevel: line.outputLevel,
      inventory: line.inventory, capacityLevel: line.capacityLevel,
      discardedBaseUnits: line.discardedBaseUnits, factory
    });
  }
  const boardResult = restoreBoard(saved.board, lines);
  if (!boardResult || saved.nextItemId <= boardResult.largestId) return null;
  const shared = restoreShared(saved.shared, lines);
  if (!shared || !Array.isArray(saved.order.requirements) ||
      saved.order.requirements.length < 1 || saved.order.requirements.length > PRODUCTS.length ||
      !isId(saved.order.reward)) return null;
  const requirements = [];
  for (const requirement of saved.order.requirements) {
    if (!isRecord(requirement) || !PRODUCTS.includes(requirement.product) ||
        requirements.some(other => other.product === requirement.product) ||
        !Number.isInteger(requirement.level) || requirement.level < 1 || requirement.level > RULES.maxLevel ||
        requirement.level < lines.find(line => line.product === requirement.product).outputLevel) return null;
    requirements.push({ product: requirement.product, level: requirement.level });
  }
  return {
    schemaVersion: 4, coins: saved.coins, completedOrders: saved.completedOrders,
    page: saved.page, selectedCell: saved.selectedCell, selectedLineId: saved.selectedLineId,
    board: boardResult.board, lines, shared,
    order: { id: saved.order.id, requirements, reward: saved.order.reward }, nextItemId: saved.nextItemId
  };
}

function migrateLegacy(saved) {
  if (!isRecord(saved.line) || saved.line.id !== 'original-1' ||
      !isCount(saved.line.inventory) || !isOutputLevel(saved.line.outputLevel) ||
      (saved.schemaVersion < 3 && saved.line.outputLevel !== 1) ||
      saved.order.product !== 'original' || saved.order.level !== 5 || saved.order.reward !== 180 ||
      saved.nextItemId >= Number.MAX_SAFE_INTEGER) return null;
  const capacityLevel = saved.schemaVersion === 1 ? 1 : saved.line.capacityLevel;
  const discardedBaseUnits = saved.schemaVersion === 3 ? saved.line.discardedBaseUnits : 0;
  if (!isCapacityLevel(capacityLevel) || !isCount(discardedBaseUnits)) return null;
  const factory = restoreFactory(saved.factory, capacityLevel, saved.line.outputLevel, saved.schemaVersion);
  if (!factory) return null;
  const original = {
    id: 'original-1', product: 'original', outputLevel: saved.line.outputLevel,
    inventory: saved.line.inventory, capacityLevel, discardedBaseUnits, factory
  };
  const boardResult = restoreBoard(saved.board, [original]);
  if (!boardResult || saved.nextItemId <= boardResult.largestId) return null;
  const board = boardResult.board;
  const shared = createLegacyShared();
  shared.supply.queue = ['caramel-1'];
  if (factory.phase === 'supply' || factory.phase === 'packaging') {
    shared[factory.phase].lineId = original.id;
    shared[factory.phase].elapsed = factory.elapsed;
  }
  let launcherCell = board[12] === null ? 12 : board.findIndex(item => item === null);
  if (launcherCell < 0) {
    launcherCell = board[12].kind === 'product' ? 12 : board.findIndex(item => item.kind === 'product');
    const displacedUnits = baseUnits(board[launcherCell].level);
    const unitSize = baseUnits(original.outputLevel);
    const recoveredInventory = Math.floor(displacedUnits / unitSize);
    if (!Number.isSafeInteger(original.inventory + recoveredInventory)) return null;
    original.inventory += recoveredInventory;
    // A lone Lv.1 item on a Lv.2 line becomes raw material, preserving its value.
    shared.materials.baseUnits += displacedUnits % unitSize;
  }
  board[launcherCell] = {
    kind: 'launcher', lineId: 'caramel-1', product: 'caramel', level: 1, id: saved.nextItemId
  };
  return {
    schemaVersion: 4, coins: saved.coins, completedOrders: saved.completedOrders,
    page: saved.page, selectedCell: saved.selectedCell, selectedLineId: 'original-1',
    board, lines: [original, createLegacyLine('caramel')], shared,
    order: { id: saved.order.id, requirements: [{ product: 'original', level: 5 }], reward: 180 },
    nextItemId: saved.nextItemId + 1
  };
}

const SCHEMA_VERSION = 5;

function createFactory(line) {
  const spec = getBatchSpec(line.product, line.outputLevel, line.capacityLevel);
  return {
    phase: 'waiting-supply', elapsed: 0, duration: 0, batchId: null,
    outputLevel: line.outputLevel, capacityLevel: line.capacityLevel,
    batchUnits: spec.batchUnits, baseUnits: spec.baseUnits
  };
}

function describeFactory(line) {
  const f = line.factory;
  return { id: f.batchId, lineId: line.id, product: line.product,
    outputLevel: f.outputLevel, capacityLevel: f.capacityLevel,
    batchUnits: f.batchUnits, baseUnits: f.baseUnits };
}

function batchDescriptor(batch) {
  return { id: batch.id, lineId: batch.lineId, product: batch.product,
    outputLevel: batch.outputLevel, capacityLevel: batch.capacityLevel,
    batchUnits: batch.batchUnits, baseUnits: batch.baseUnits };
}

function cacheLoad(line) {
  return line.buffer.reduce((sum, batch) => sum + batch.baseUnits, 0);
}

function configuredLineOrder(left, right) {
  return CONFIG.lines.findIndex(line => line.id === left.id) -
    CONFIG.lines.findIndex(line => line.id === right.id);
}

function createInitialState() {
  const initialDefinitions = CONFIG.initialLineIds.map(id => CONFIG.lines.find(definition => definition.id === id));
  const lines = initialDefinitions.map(definition => ({
    id: definition.id, product: definition.product, outputLevel: 1, capacityLevel: 1,
    inventory: 0, discardedBaseUnits: 0, cacheCapacityBaseUnits: CONFIG.cacheCapacityBaseUnits,
    buffer: [], warehouse: [], legacyGroup: null
  }));
  const board = Array(RULES.boardSize).fill(null);
  for (const [index, definition] of initialDefinitions.entries()) {
    const line = lines[index];
    line.factory = createFactory(line);
    board[definition.launcherCell] = { kind: 'launcher', lineId: line.id,
      product: line.product, level: line.outputLevel, id: index + 1 };
  }
  return {
    schemaVersion: SCHEMA_VERSION, productionAt: null, nextBatchId: 1,
    coins: 0, completedOrders: 0, page: 'board', selectedCell: initialDefinitions[0].launcherCell,
    selectedLineId: lines[0].id, board, lines, ...createOrderBook(makeOrder(1, lines), lines, 0), nextItemId: lines.length + 1,
    shared: {
      materials: { baseUnits: CONFIG.materialRefillBaseUnits, capacityBaseUnits: CONFIG.materialCapacityBaseUnits,
        elapsed: 0, duration: CONFIG.materialRefillSeconds, refillBaseUnits: CONFIG.materialRefillBaseUnits, refilledBaseUnits: 0 },
      supply: { level: 1, lineId: null, elapsed: 0, duration: CONFIG.phaseDurations.supply, queue: lines.map(line => line.id) },
      packaging: { level: 1, lineId: null, batch: null, elapsed: 0, duration: CONFIG.phaseDurations.packaging, queue: [] }
    }
  };
}

function upgradeLegacyState(saved) {
  const state = { ...saved, schemaVersion: SCHEMA_VERSION, productionAt: null, nextBatchId: 1 };
  state.lines = saved.lines.map(previous => ({
    id: previous.id, product: previous.product, outputLevel: previous.outputLevel,
    capacityLevel: previous.capacityLevel, inventory: previous.inventory,
    discardedBaseUnits: previous.discardedBaseUnits,
    cacheCapacityBaseUnits: CONFIG.cacheCapacityBaseUnits,
    factory: null, buffer: [], warehouse: [], legacyGroup: null
  }));
  state.shared = {
    materials: { ...saved.shared.materials, refilledBaseUnits: 0 },
    supply: { ...saved.shared.supply, level: 1, queue: [...saved.shared.supply.queue] },
    packaging: { level: 1, lineId: null, batch: null, elapsed: 0,
      duration: CONFIG.phaseDurations.packaging, queue: [] }
  };
  for (const line of state.lines) {
    const previous = saved.lines.find(candidate => candidate.id === line.id).factory;
    line.factory = createFactory(line);
    if (previous.phase === 'waiting-supply') continue;
    const spec = getBatchSpec(line.product, previous.outputLevel, previous.capacityLevel);
    const batch = { id: state.nextBatchId++, lineId: line.id, product: line.product,
      outputLevel: previous.outputLevel, capacityLevel: previous.capacityLevel,
      batchUnits: spec.batchUnits, baseUnits: spec.baseUnits };
    if (MAIN_PHASES.includes(previous.phase)) {
      line.factory = { ...previous, batchId: batch.id, baseUnits: batch.baseUnits };
    } else if (previous.phase === 'warehouse') {
      line.warehouse.push({ ...batch, elapsed: previous.elapsed,
        duration: CONFIG.phaseDurations.warehouse, credited: false });
    } else {
      line.buffer.push({ ...batch, status: previous.phase === 'packaging' ? 'packaging' : 'waiting' });
      if (previous.phase === 'packaging') {
        state.shared.packaging.lineId = line.id;
        state.shared.packaging.batch = batch;
        state.shared.packaging.elapsed = previous.elapsed;
      }
    }
    if (batch.outputLevel < line.outputLevel) {
      if (previous.phase === 'warehouse') {
        // It is already a complete packaged good. Its remaining transit is
        // visual after the old group settles, and must never award it twice.
        line.legacyGroup = { batchIds: [], completedBaseUnits: batch.baseUnits,
          completedBatches: [batch] };
        line.warehouse[0].credited = true;
      } else line.legacyGroup = { batchIds: [batch.id], completedBaseUnits: 0, completedBatches: [] };
    }
  }
  state.shared.supply.queue = state.shared.supply.queue.filter(id =>
    state.lines.find(line => line.id === id).factory.phase === 'waiting-supply');
  for (const line of state.lines) {
    if (line.factory.phase === 'waiting-supply' && !state.shared.supply.queue.includes(line.id)) {
      state.shared.supply.queue.push(line.id);
    }
  }
  state.shared.packaging.queue = saved.shared.packaging.queue.filter(id =>
    state.lines.find(line => line.id === id).buffer.some(batch => batch.status === 'waiting'));
  for (const line of state.lines) {
    if (line.buffer.some(batch => batch.status === 'waiting') && !state.shared.packaging.queue.includes(line.id)) {
      state.shared.packaging.queue.push(line.id);
    }
  }
  return state;
}

function restoreBatch(saved, line) {
  if (!isRecord(saved) || !isId(saved.id) || saved.lineId !== line.id || saved.product !== line.product ||
      !isOutputLevel(saved.outputLevel) || saved.outputLevel > line.outputLevel ||
      !isCapacityLevel(saved.capacityLevel) || saved.capacityLevel > line.capacityLevel) return null;
  const spec = getBatchSpec(line.product, saved.outputLevel, saved.capacityLevel);
  if (saved.batchUnits !== spec.batchUnits || saved.baseUnits !== spec.baseUnits) return null;
  return batchDescriptor(saved);
}

function restoreProductionState(saved) {
  if (!isRecord(saved)) return null;
  if (saved.schemaVersion !== SCHEMA_VERSION) {
    const legacy = restoreLegacyState(saved);
    if (!legacy) return null;
    const migrated = upgradeLegacyState(legacy);
    for (const line of migrated.lines) {
      const group = line.legacyGroup;
      if (!group || group.batchIds.length) continue;
      const units = Math.floor(group.completedBaseUnits / baseUnits(line.outputLevel));
      const discarded = group.completedBaseUnits % baseUnits(line.outputLevel);
      if (!Number.isSafeInteger(line.inventory + units) ||
          !Number.isSafeInteger(line.discardedBaseUnits + discarded)) return null;
      line.inventory += units; line.discardedBaseUnits += discarded; line.legacyGroup = null;
    }
    // Migration is subject to the same physical ownership and safe-number
    // checks as a current save before it can be written to the new key.
    return restoreProductionState(migrated);
  }
  if (!isCount(saved.coins) || !isCount(saved.completedOrders) ||
      !['board', 'factory'].includes(saved.page) || !isCell(saved.selectedCell) ||
      !isId(saved.nextItemId) || !isId(saved.nextBatchId) ||
      (saved.productionAt !== null && !isCount(saved.productionAt)) ||
      !Array.isArray(saved.lines) || !isRecord(saved.shared)) return null;
  if (!isRecord(saved.shared.supply) || !isRecord(saved.shared.packaging)) return null;
  const hasSupplyLevel = Object.prototype.hasOwnProperty.call(saved.shared.supply, 'level');
  const hasPackagingLevel = Object.prototype.hasOwnProperty.call(saved.shared.packaging, 'level');
  // Both absent identifies the original schema-5 saves. A partially removed
  // new field must stay protected rather than silently losing an upgrade.
  if (hasSupplyLevel !== hasPackagingLevel) return null;
  const levels = { supply: hasSupplyLevel ? saved.shared.supply.level : 1,
    packaging: hasPackagingLevel ? saved.shared.packaging.level : 1 };
  if (!sharedSpec('supply', levels.supply) || !sharedSpec('packaging', levels.packaging)) return null;
  const lines = [], physicalIds = new Set();
  const claimBatch = batch => {
    if (!batch || physicalIds.has(batch.id) || batch.id >= saved.nextBatchId) return false;
    physicalIds.add(batch.id); return true;
  };
  for (const previous of saved.lines) {
    const definition = CONFIG.lines.find(line => line.id === previous?.id);
    if (!definition || lines.some(line => line.id === definition.id) || previous.product !== definition.product ||
        !isOutputLevel(previous.outputLevel) || !isCapacityLevel(previous.capacityLevel) ||
        !isCount(previous.inventory) || !isCount(previous.discardedBaseUnits) ||
        previous.cacheCapacityBaseUnits !== CONFIG.cacheCapacityBaseUnits ||
        !Array.isArray(previous.buffer) || !Array.isArray(previous.warehouse) || !isRecord(previous.factory)) return null;
    const line = { id: previous.id, product: previous.product, outputLevel: previous.outputLevel,
      capacityLevel: previous.capacityLevel, inventory: previous.inventory,
      discardedBaseUnits: previous.discardedBaseUnits, cacheCapacityBaseUnits: previous.cacheCapacityBaseUnits,
      factory: null, buffer: [], warehouse: [], legacyGroup: null };
    const f = previous.factory, spec = getBatchSpec(line.product, f.outputLevel, f.capacityLevel);
    if (!FACTORY_PHASES.includes(f.phase) || !spec || f.outputLevel > line.outputLevel ||
        f.capacityLevel > line.capacityLevel || f.batchUnits !== spec.batchUnits || f.baseUnits !== spec.baseUnits ||
        !Number.isFinite(f.elapsed) || f.elapsed < 0) return null;
    const duration = f.phase === 'supply' ? saved.shared.supply.duration :
      MAIN_PHASES.includes(f.phase) ? spec.phaseDurations[f.phase] : 0;
    if (f.duration !== duration || (duration ? f.elapsed >= duration : f.elapsed !== 0)) return null;
    if (f.phase === 'waiting-supply') {
      if (f.batchId !== null || f.outputLevel !== line.outputLevel || f.capacityLevel !== line.capacityLevel) return null;
    } else if (!claimBatch(restoreBatch({ ...f, id: f.batchId, lineId: line.id, product: line.product }, line))) return null;
    line.factory = { phase: f.phase, elapsed: f.elapsed, duration: f.duration, batchId: f.batchId,
      outputLevel: f.outputLevel, capacityLevel: f.capacityLevel, batchUnits: f.batchUnits, baseUnits: f.baseUnits };
    for (const item of previous.buffer) {
      const batch = restoreBatch(item, line);
      if (!claimBatch(batch) || !['waiting', 'packaging'].includes(item.status)) return null;
      line.buffer.push({ ...batch, status: item.status });
    }
    if (cacheLoad(line) > line.cacheCapacityBaseUnits ||
        line.buffer.filter(batch => batch.status === 'packaging').length > 1 ||
        (f.phase === 'waiting-cache' && cacheLoad(line) + f.baseUnits <= line.cacheCapacityBaseUnits)) return null;
    for (const item of previous.warehouse) {
      const batch = restoreBatch(item, line);
      if (!claimBatch(batch) || typeof item.credited !== 'boolean' ||
          item.duration !== CONFIG.phaseDurations.warehouse || !Number.isFinite(item.elapsed) ||
          item.elapsed < 0 || item.elapsed >= item.duration) return null;
      line.warehouse.push({ ...batch, elapsed: item.elapsed, duration: item.duration, credited: item.credited });
    }
    if (previous.legacyGroup !== null) {
      const group = previous.legacyGroup;
      if (!isRecord(group) || !Array.isArray(group.batchIds) || !group.batchIds.length || !Array.isArray(group.completedBatches) ||
          !isCount(group.completedBaseUnits) || new Set(group.batchIds).size !== group.batchIds.length) return null;
      const pending = new Set([f.batchId, ...line.buffer.map(batch => batch.id)].filter(isId));
      if (group.batchIds.some(id => !isId(id) || !pending.has(id))) return null;
      const completed = [], completedIds = new Set();
      for (const item of group.completedBatches) {
        const batch = restoreBatch(item, line);
        if (!batch || batch.outputLevel >= line.outputLevel || batch.id >= saved.nextBatchId ||
            completedIds.has(batch.id) || pending.has(batch.id)) return null;
        completedIds.add(batch.id);
        const transit = line.warehouse.find(candidate => candidate.id === batch.id);
        if (transit && (!transit.credited || JSON.stringify(batchDescriptor(transit)) !== JSON.stringify(batch))) return null;
        completed.push(batch);
      }
      if (completed.reduce((sum, batch) => sum + batch.baseUnits, 0) !== group.completedBaseUnits) return null;
      if (line.warehouse.some(batch => batch.credited && !completedIds.has(batch.id))) return null;
      line.legacyGroup = { batchIds: [...group.batchIds], completedBaseUnits: group.completedBaseUnits,
        completedBatches: completed };
    }
    const oldPending = [f.phase === 'waiting-supply' ? null : describeFactory(line), ...line.buffer]
      .filter(batch => batch && batch.outputLevel < line.outputLevel);
    if (oldPending.some(batch => !line.legacyGroup || !line.legacyGroup.batchIds.includes(batch.id)) ||
        (line.legacyGroup && line.legacyGroup.batchIds.some(id =>
          !oldPending.some(batch => batch.id === id)))) return null;
    if (line.warehouse.some(batch => (!batch.credited && batch.outputLevel !== line.outputLevel) ||
        (batch.credited && batch.outputLevel >= line.outputLevel))) return null;
    lines.push(line);
  }
  if (CONFIG.initialLineIds.some(id => !lines.some(line => line.id === id)) ||
      !lines.some(line => line.id === saved.selectedLineId)) return null;
  for (const product of PRODUCTS) {
    const productLines = lines.filter(line => line.product === product);
    if (!productLines.length || productLines.length > CONFIG.maxLinesPerProduct ||
        productLines.some((_, index) => !productLines.some(line => line.id === `${product}-${index + 1}`))) return null;
  }
  // Array order is presentation data; ties in scheduling use configured line
  // order so reordering a saved array cannot change production allocation.
  lines.sort(configuredLineOrder);
  const completedIds = new Set();
  for (const line of lines) {
    for (const batch of line.legacyGroup?.completedBatches || []) {
      if (completedIds.has(batch.id)) return null;
      completedIds.add(batch.id);
      if (physicalIds.has(batch.id) && !line.warehouse.some(transit =>
        transit.id === batch.id && transit.credited)) return null;
    }
    const pendingBaseUnits = (line.factory.batchId === null ? 0 : line.factory.baseUnits) + cacheLoad(line) +
      line.warehouse.reduce((sum, batch) => sum + (batch.credited ? 0 : batch.baseUnits), 0) +
      (line.legacyGroup?.completedBaseUnits || 0);
    if (!Number.isSafeInteger(pendingBaseUnits) ||
        !Number.isSafeInteger(line.inventory + Math.floor(pendingBaseUnits / baseUnits(line.outputLevel))) ||
        !Number.isSafeInteger(line.discardedBaseUnits + pendingBaseUnits)) return null;
  }
  const boardResult = restoreBoard(saved.board, lines);
  if (!boardResult || saved.nextItemId <= boardResult.largestId) return null;
  const m = saved.shared.materials;
  if (!isRecord(m) || !isCount(m.baseUnits) || m.baseUnits > CONFIG.materialCapacityBaseUnits ||
      !isCount(m.refilledBaseUnits) || m.capacityBaseUnits !== CONFIG.materialCapacityBaseUnits ||
      m.refillBaseUnits !== CONFIG.materialRefillBaseUnits ||
      !validSharedDuration('supply', levels.supply, m.duration, 'refillSeconds') ||
      !Number.isFinite(m.elapsed) || m.elapsed < 0 || m.elapsed >= m.duration ||
      (m.baseUnits === m.capacityBaseUnits && m.elapsed !== 0) ||
      (m.elapsed === 0 && m.duration !== sharedSpec('supply', levels.supply).refillSeconds)) return null;
  const shared = { materials: { baseUnits: m.baseUnits, capacityBaseUnits: m.capacityBaseUnits,
    elapsed: m.elapsed, duration: m.duration, refillBaseUnits: m.refillBaseUnits, refilledBaseUnits: m.refilledBaseUnits } };
  for (const name of ['supply', 'packaging']) {
    const service = saved.shared[name];
    if (!isRecord(service) || !Array.isArray(service.queue) ||
        new Set(service.queue).size !== service.queue.length || service.queue.some(id => !lines.some(line => line.id === id)) ||
        !Number.isFinite(service.elapsed) || service.elapsed < 0 ||
        !validSharedDuration(name, levels[name], service.duration) ||
        service.elapsed >= service.duration ||
        (service.lineId !== null && !lines.some(line => line.id === service.lineId)) ||
        (service.lineId === null && service.duration !== sharedSpec(name, levels[name]).serviceSeconds)) return null;
    const waiting = name === 'supply' ? lines.filter(line => line.factory.phase === 'waiting-supply') :
      lines.filter(line => line.buffer.some(batch => batch.status === 'waiting'));
    if (waiting.length !== service.queue.length || waiting.some(line => !service.queue.includes(line.id))) return null;
    if (name === 'supply') {
      const active = lines.filter(line => line.factory.phase === 'supply');
      if (active.length > 1 || service.lineId !== (active[0]?.id || null) ||
          service.elapsed !== (active[0]?.factory.elapsed || 0)) return null;
      shared.supply = { level: levels.supply, lineId: service.lineId, elapsed: service.elapsed,
        duration: service.duration, queue: [...service.queue] };
    } else {
      const active = lines.flatMap(line => line.buffer.filter(batch => batch.status === 'packaging'));
      if (active.length > 1 || service.lineId !== (active[0]?.lineId || null) ||
          (!active.length && (service.batch !== null || service.elapsed !== 0))) return null;
      const batch = active.length ? restoreBatch(service.batch, lines.find(line => line.id === service.lineId)) : null;
      if (active.length && (!batch || JSON.stringify(batch) !== JSON.stringify(batchDescriptor(active[0])))) return null;
      shared.packaging = { level: levels.packaging, lineId: service.lineId, batch, elapsed: service.elapsed,
        duration: service.duration, queue: [...service.queue] };
    }
  }
  const alias = restoreOrder(saved.order, lines);
  if (!alias) return null;
  const orderFields = ['orders', 'focusedOrderId', 'nextOrderId', 'customerServiceCounts'];
  const hasOrderFields = orderFields.map(field => Object.prototype.hasOwnProperty.call(saved, field));
  let orderBook;
  if (hasOrderFields.every(value => !value)) {
    if (alias.id !== saved.completedOrders + 1 ||
        !Number.isSafeInteger(alias.id + CONFIG.parallelOrderSlots)) return null;
    orderBook = createOrderBook(alias, lines, saved.completedOrders);
  } else {
    if (!hasOrderFields.every(Boolean) || !Array.isArray(saved.orders) ||
        saved.orders.length !== CONFIG.parallelOrderSlots || !isId(saved.focusedOrderId) ||
        !isId(saved.nextOrderId) || saved.nextOrderId !== saved.completedOrders + CONFIG.parallelOrderSlots + 1 ||
        !isRecord(saved.customerServiceCounts) ||
        Object.keys(saved.customerServiceCounts).length !== 1 ||
        !isCount(saved.customerServiceCounts[CONFIG.currentCustomerId]) ||
        saved.customerServiceCounts[CONFIG.currentCustomerId] !== saved.completedOrders) return null;
    const orders = [], ids = new Set();
    for (const previous of saved.orders) {
      const order = restoreOrder(previous, lines);
      if (!order || order.id >= saved.nextOrderId || ids.has(order.id)) return null;
      ids.add(order.id); orders.push(order);
    }
    const focused = orders.find(order => order.id === saved.focusedOrderId);
    if (!focused || !sameOrder(alias, focused)) return null;
    orderBook = { orders, focusedOrderId: focused.id, nextOrderId: saved.nextOrderId, order: focused,
      customerServiceCounts: { [CONFIG.currentCustomerId]: saved.customerServiceCounts[CONFIG.currentCustomerId] } };
  }
  return { schemaVersion: SCHEMA_VERSION, productionAt: saved.productionAt, nextBatchId: saved.nextBatchId,
    coins: saved.coins, completedOrders: saved.completedOrders, page: saved.page,
    selectedCell: saved.selectedCell, selectedLineId: saved.selectedLineId, board: boardResult.board,
    nextItemId: saved.nextItemId, lines, shared, ...orderBook };
}

class GameModel {
  constructor(saved) {
    const restored = restoreProductionState(saved);
    this.state = restored || createInitialState();
    this.restored = Boolean(restored);
    this.recoveryRequired = saved !== undefined && saved !== null && !restored;
    for (const line of this.state.lines) this.settleLegacyGroup(line);
    this.dispatchShared();
  }

  getLine(lineId = this.state.selectedLineId) {
    return this.state.lines.find(line => line.id === lineId) || null;
  }

  selectLine(lineId) {
    const line = this.getLine(lineId);
    if (!line) return { ok: false, reason: 'invalid-line' };
    this.state.selectedLineId = lineId;
    this.state.selectedCell = this.launcherIndex(lineId);
    return { ok: true, action: 'select-line', lineId, product: line.product };
  }

  lineExpansionOffer(target = this.state.selectedLineId) {
    const product = PRODUCTS.includes(target) ? target : this.getLine(target)?.product;
    if (!product) return null;
    const lineCount = this.state.lines.filter(line => line.product === product).length;
    const maxed = lineCount >= CONFIG.maxLinesPerProduct;
    const nextLineNumber = maxed ? null : lineCount + 1;
    const nextLineId = nextLineNumber === null ? null : `${product}-${nextLineNumber}`;
    const launcherCell = this.state.board.findIndex(item => item === null);
    const hasSpace = launcherCell >= 0;
    const affordable = !maxed && isCount(this.state.coins) && this.state.coins >= CONFIG.lineExpansionCost;
    const numericReady = isCount(this.state.coins) && isId(this.state.nextItemId) &&
      this.state.nextItemId < Number.MAX_SAFE_INTEGER &&
      this.state.board.every(item => !item || (isId(item.id) && item.id < this.state.nextItemId)) &&
      isId(this.state.nextBatchId) && this.state.nextBatchId < Number.MAX_SAFE_INTEGER;
    const definition = CONFIG.lines.find(line => line.id === nextLineId && line.product === product);
    const reason = maxed ? 'line-max' : !numericReady || !definition ? 'numeric-limit' :
      !affordable ? 'insufficient-coins' : !hasSpace ? 'board-full' : null;
    return {
      product, cost: CONFIG.lineExpansionCost, lineCount, maxLines: CONFIG.maxLinesPerProduct,
      maxed, affordable, hasSpace, boardSpaceAvailable: hasSpace, canBuy: reason === null,
      nextLineId, nextLineNumber, launcherCell, reason, sharedLimited: true
    };
  }

  buyLine(product) {
    const failure = reason => ({ ok: false, action: 'line-buy', product, reason });
    if (!PRODUCTS.includes(product)) return failure('invalid-product');
    const offer = this.lineExpansionOffer(product);
    if (!offer.canBuy) return failure(offer.reason);
    const line = {
      id: offer.nextLineId, product, outputLevel: 1, capacityLevel: 1,
      inventory: 0, discardedBaseUnits: 0, cacheCapacityBaseUnits: CONFIG.cacheCapacityBaseUnits,
      buffer: [], warehouse: [], legacyGroup: null
    };
    line.factory = createFactory(line);
    const itemId = this.state.nextItemId;
    const launcher = { kind: 'launcher', lineId: line.id, product, level: 1, id: itemId };
    // Commit only after every prerequisite and the complete new structures
    // are ready. Existing batches, goods and order targets keep their values.
    this.state.coins -= offer.cost;
    this.state.nextItemId++;
    this.state.lines.push(line);
    this.state.lines.sort(configuredLineOrder);
    this.state.board[offer.launcherCell] = launcher;
    this.state.shared.supply.queue.push(line.id);
    this.state.selectedLineId = line.id;
    this.state.selectedCell = offer.launcherCell;
    return { ok: true, action: 'line-buy', product, lineId: line.id, lineNumber: offer.nextLineNumber,
      cost: offer.cost, itemId, to: offer.launcherCell, launcherCell: offer.launcherCell };
  }

  refreshWaiting(line) {
    if (line.factory.phase === 'waiting-supply') line.factory = createFactory(line);
  }

  enqueuePackaging(line) {
    const service = this.state.shared.packaging;
    if (line.buffer.some(batch => batch.status === 'waiting') && !service.queue.includes(line.id)) service.queue.push(line.id);
  }

  releaseMachine(line) {
    line.factory = createFactory(line);
    if (!this.state.shared.supply.queue.includes(line.id)) this.state.shared.supply.queue.push(line.id);
  }

  cacheFinishedBatch(line) {
    if (cacheLoad(line) + line.factory.baseUnits > line.cacheCapacityBaseUnits) {
      line.factory.phase = 'waiting-cache'; line.factory.elapsed = 0; line.factory.duration = 0;
      return;
    }
    line.buffer.push({ ...describeFactory(line), status: 'waiting' });
    this.enqueuePackaging(line);
    this.releaseMachine(line);
  }

  dispatchShared() {
    for (const line of this.state.lines) {
      if (line.factory.phase === 'waiting-cache' && cacheLoad(line) + line.factory.baseUnits <= line.cacheCapacityBaseUnits) {
        this.cacheFinishedBatch(line);
      }
    }
    const supply = this.state.shared.supply;
    if (supply.lineId === null) {
      // Search eligible lines, so a line without space/material never holds
      // the shared service idle while a different line can make progress.
      const position = supply.queue.findIndex(id => {
        const line = this.getLine(id);
        this.refreshWaiting(line);
        return cacheLoad(line) + line.factory.baseUnits <= line.cacheCapacityBaseUnits &&
          this.state.shared.materials.baseUnits >= line.factory.baseUnits;
      });
      if (position >= 0 && this.state.nextBatchId < Number.MAX_SAFE_INTEGER) {
        const id = supply.queue.splice(position, 1)[0], line = this.getLine(id), f = line.factory;
        this.state.shared.materials.baseUnits -= f.baseUnits;
        f.batchId = this.state.nextBatchId++; f.phase = 'supply'; f.elapsed = 0;
        supply.duration = sharedSpec('supply', supply.level).serviceSeconds;
        f.duration = supply.duration;
        supply.lineId = id; supply.elapsed = 0;
      }
    }
    const packaging = this.state.shared.packaging;
    if (packaging.lineId === null && packaging.queue.length) {
      const id = packaging.queue.shift(), line = this.getLine(id);
      const batch = line.buffer.find(candidate => candidate.status === 'waiting');
      batch.status = 'packaging'; packaging.lineId = id;
      packaging.batch = batchDescriptor(batch); packaging.elapsed = 0;
      packaging.duration = sharedSpec('packaging', packaging.level).serviceSeconds;
      this.enqueuePackaging(line);
    }
  }

  finishPhase(line) {
    const f = line.factory, phase = f.phase;
    if (phase === 'supply') {
      this.state.shared.supply.lineId = null;
      this.state.shared.supply.elapsed = 0;
      this.state.shared.supply.duration = sharedSpec('supply', this.state.shared.supply.level).serviceSeconds;
    }
    if (phase === 'transport') { this.cacheFinishedBatch(line); return; }
    f.phase = MAIN_PHASES[MAIN_PHASES.indexOf(phase) + 1];
    f.elapsed = 0;
    f.duration = getBatchSpec(line.product, f.outputLevel, f.capacityLevel).phaseDurations[f.phase];
  }

  credit(line, materialUnits) {
    const unitSize = baseUnits(line.outputLevel);
    line.inventory += Math.floor(materialUnits / unitSize);
    line.discardedBaseUnits += materialUnits % unitSize;
  }

  settleLegacyGroup(line) {
    const group = line.legacyGroup;
    if (!group || group.batchIds.length) return;
    this.credit(line, group.completedBaseUnits);
    line.legacyGroup = null;
  }

  finishPackaging() {
    const service = this.state.shared.packaging, line = this.getLine(service.lineId);
    const batch = service.batch;
    line.buffer = line.buffer.filter(candidate => candidate.id !== batch.id);
    let credited = false;
    const group = line.legacyGroup;
    if (group && group.batchIds.includes(batch.id)) {
      group.batchIds = group.batchIds.filter(id => id !== batch.id);
      group.completedBatches.push(batchDescriptor(batch));
      group.completedBaseUnits += batch.baseUnits;
      credited = true;
      this.settleLegacyGroup(line);
    }
    line.warehouse.push({ ...batch, elapsed: 0, duration: CONFIG.phaseDurations.warehouse, credited });
    service.lineId = null; service.batch = null; service.elapsed = 0;
    service.duration = sharedSpec('packaging', service.level).serviceSeconds;
    this.enqueuePackaging(line);
  }

  update(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return { ok: false, reason: 'invalid-time' };
    if (seconds === 0) return { ok: true, produced: 0, producedByLine: [] };
    const supplySpec = sharedSpec('supply', this.state.shared.supply.level);
    const fastestRefill = Math.min(this.state.shared.materials.duration, supplySpec.refillSeconds);
    const fastestSupply = Math.min(this.state.shared.supply.duration, supplySpec.serviceSeconds);
    const upperMaterial = (Math.ceil(seconds / fastestRefill) + 1) * CONFIG.materialRefillBaseUnits;
    if (!Number.isSafeInteger(upperMaterial) || this.state.nextBatchId > Number.MAX_SAFE_INTEGER - Math.ceil(seconds / fastestSupply) - 1 ||
        this.state.shared.materials.refilledBaseUnits > Number.MAX_SAFE_INTEGER - upperMaterial ||
        this.state.lines.some(line => {
          const pending = (line.factory.batchId === null ? 0 : line.factory.baseUnits) + cacheLoad(line) +
            line.warehouse.reduce((sum, batch) => sum + (batch.credited ? 0 : batch.baseUnits), 0) +
            (line.legacyGroup?.completedBaseUnits || 0);
          const potential = pending + this.state.shared.materials.baseUnits + upperMaterial;
          return Math.floor(potential / baseUnits(line.outputLevel)) > Number.MAX_SAFE_INTEGER - line.inventory ||
            (line.outputLevel > 1 && potential > Number.MAX_SAFE_INTEGER - line.discardedBaseUnits);
        })) return { ok: false, reason: 'numeric-limit' };
    const before = this.state.lines.map(line => line.inventory);
    let remaining = seconds;
    while (remaining > EPSILON) {
      this.dispatchShared();
      const material = this.state.shared.materials, packaging = this.state.shared.packaging;
      const active = this.state.lines.filter(line => MAIN_PHASES.includes(line.factory.phase));
      const transit = this.state.lines.flatMap(line => line.warehouse.map(batch => ({ line, batch })));
      let step = remaining;
      if (material.baseUnits < material.capacityBaseUnits) step = Math.min(step, material.duration - material.elapsed);
      for (const line of active) step = Math.min(step, line.factory.duration - line.factory.elapsed);
      if (packaging.batch) step = Math.min(step, packaging.duration - packaging.elapsed);
      for (const { batch } of transit) step = Math.min(step, batch.duration - batch.elapsed);
      if (material.baseUnits < material.capacityBaseUnits) material.elapsed += step;
      for (const line of active) line.factory.elapsed += step;
      if (packaging.batch) packaging.elapsed += step;
      for (const { batch } of transit) batch.elapsed += step;
      remaining = Math.max(0, remaining - step);
      if (material.elapsed >= material.duration - EPSILON) {
        const added = Math.min(material.capacityBaseUnits - material.baseUnits, material.refillBaseUnits);
        material.baseUnits += added; material.refilledBaseUnits += added; material.elapsed = 0;
        material.duration = sharedSpec('supply', this.state.shared.supply.level).refillSeconds;
      }
      for (const line of active) {
        if (line.factory.elapsed >= line.factory.duration - EPSILON) this.finishPhase(line);
      }
      if (packaging.batch && packaging.elapsed >= packaging.duration - EPSILON) this.finishPackaging();
      for (const { line, batch } of transit) {
        if (batch.elapsed >= batch.duration - EPSILON) {
          if (!batch.credited) this.credit(line, batch.baseUnits);
          line.warehouse = line.warehouse.filter(candidate => candidate.id !== batch.id);
        }
      }
      const supply = this.state.shared.supply;
      if (supply.lineId !== null) supply.elapsed = this.getLine(supply.lineId).factory.elapsed;
      this.dispatchShared();
    }
    const producedByLine = this.state.lines.map((line, index) => ({ lineId: line.id,
      product: line.product, level: line.outputLevel, units: line.inventory - before[index] })).filter(line => line.units > 0);
    return { ok: true, produced: producedByLine.reduce((sum, line) => sum + line.units, 0), producedByLine };
  }

  consumeWallTime(nowMs, limitSeconds) {
    if (!isCount(nowMs)) return { ok: false, reason: 'invalid-time' };
    const anchor = this.state.productionAt;
    const elapsedSeconds = anchor === null ? 0 : Math.max(0, (nowMs - anchor) / 1000);
    const seconds = Math.min(elapsedSeconds, limitSeconds);
    const result = this.update(seconds);
    if (!result.ok) return result;
    this.state.productionAt = anchor === null ? nowMs : Math.max(anchor, nowMs);
    return { ...result, seconds, elapsedSeconds, capped: elapsedSeconds > limitSeconds };
  }

  advanceProduction(nowMs) { return this.consumeWallTime(nowMs, Infinity); }
  resumeProduction(nowMs) { return this.consumeWallTime(nowMs, CONFIG.offlineLimitSeconds); }

  sharedUpgradeOffer(serviceName) {
    if (!['supply', 'packaging'].includes(serviceName)) return null;
    const service = this.state.shared[serviceName], level = service.level;
    const maxed = level === CONFIG.maxSharedLevel, nextLevel = maxed ? level : level + 1;
    const current = sharedSpec(serviceName, level), next = sharedSpec(serviceName, nextLevel);
    const material = this.state.shared.materials;
    const pendingService = service.lineId !== null && service.duration !== current.serviceSeconds;
    const pendingRefill = serviceName === 'supply' && material.elapsed > 0 && material.duration !== current.refillSeconds;
    const currentSeconds = serviceName === 'supply' ? current.refillSeconds : current.serviceSeconds;
    const nextSeconds = serviceName === 'supply' ? next.refillSeconds : next.serviceSeconds;
    return {
      service: serviceName, level, nextLevel, maxed, cost: CONFIG.sharedUpgradeCost,
      affordable: !maxed && isCount(this.state.coins) && this.state.coins >= CONFIG.sharedUpgradeCost,
      currentSeconds, nextSeconds, speedGainPercent: Math.round((currentSeconds / nextSeconds - 1) * 100),
      currentServiceSeconds: current.serviceSeconds, nextServiceSeconds: next.serviceSeconds,
      activeServiceSeconds: service.duration,
      ...(serviceName === 'supply' ? { activeRefillSeconds: material.duration,
        refillBaseUnits: material.refillBaseUnits, materialCapacityBaseUnits: material.capacityBaseUnits } : {}),
      pending: pendingService || pendingRefill, tentative: true
    };
  }

  upgradeShared(serviceName) {
    const failure = reason => ({ ok: false, action: 'shared-upgrade', service: serviceName, reason });
    const offer = this.sharedUpgradeOffer(serviceName);
    if (!offer) return failure('invalid-service');
    if (offer.maxed) return failure('shared-max');
    if (!isCount(this.state.coins)) return failure('numeric-limit');
    if (!offer.affordable) return failure('insufficient-coins');
    const service = this.state.shared[serviceName], next = sharedSpec(serviceName, offer.nextLevel);
    this.state.coins -= offer.cost;
    service.level = offer.nextLevel;
    // A running operation owns its duration until completion. Only an idle
    // service, or a refill cycle not yet begun, can adopt the new duration now.
    if (service.lineId === null) service.duration = next.serviceSeconds;
    if (serviceName === 'supply' && this.state.shared.materials.elapsed === 0) {
      this.state.shared.materials.duration = next.refillSeconds;
    }
    return { ok: true, action: 'shared-upgrade', service: serviceName, level: service.level,
      cost: offer.cost, pending: this.sharedUpgradeOffer(serviceName).pending };
  }

  productionBottleneck() {
    const material = this.state.shared.materials, supply = this.state.shared.supply;
    const blocked = this.state.lines.filter(line => line.factory.phase === 'waiting-cache' ||
      (line.factory.phase === 'waiting-supply' && cacheLoad(line) + line.factory.baseUnits > line.cacheCapacityBaseUnits));
    const lacking = this.state.lines.filter(line => line.factory.phase === 'waiting-supply' &&
      cacheLoad(line) + line.factory.baseUnits <= line.cacheCapacityBaseUnits && material.baseUnits < line.factory.baseUnits);
    const supplyWaiting = this.state.lines.filter(line => line.factory.phase === 'waiting-supply' &&
      cacheLoad(line) + line.factory.baseUnits <= line.cacheCapacityBaseUnits && material.baseUnits >= line.factory.baseUnits);
    const packagingWaiting = this.state.lines.filter(line => line.buffer.some(batch => batch.status === 'waiting'));
    const queuedBatchCount = this.state.lines.reduce((sum, line) => sum +
      line.buffer.filter(batch => batch.status === 'waiting').length, 0);
    const processing = this.state.lines.filter(line => line.factory.phase === 'processing');
    let kind = 'balanced', reason = 'no-current-wait', affected = [], text = '各线正常流转，暂无明显等待';
    if (blocked.length) {
      kind = 'packaging'; reason = 'cache-full'; affected = blocked;
      text = blocked.length + '条线缓存满，等待包装腾位';
    } else if (lacking.length) {
      kind = 'supply'; reason = 'material-shortage'; affected = lacking;
      text = lacking.length + '条线缺料，等待公共补料';
    } else if (queuedBatchCount) {
      kind = 'packaging'; reason = 'packaging-queue'; affected = packagingWaiting;
      text = queuedBatchCount + '批商品等待公共包装';
    } else if (supply.lineId !== null && supplyWaiting.length) {
      kind = 'supply'; reason = 'service-queue'; affected = supplyWaiting;
      text = supplyWaiting.length + '条线有料，等待公共分料';
    } else if (processing.length) {
      kind = 'processing'; reason = 'processing'; affected = processing;
      text = processing.length + '条线加工中，尚无公共积压';
    }
    return { kind, reason, text, affectedLineIds: affected.map(line => line.id),
      waitingLineCount: kind === 'processing' || kind === 'balanced' ? 0 : affected.length,
      queuedBatchCount, observed: true,
      materialBaseUnits: material.baseUnits, materialCapacityBaseUnits: material.capacityBaseUnits,
      blockedLineIds: blocked.map(line => line.id), materialShortageLineIds: lacking.map(line => line.id) };
  }

  machineCycle(line, capacityLevel = line.capacityLevel, outputLevel = line.outputLevel) {
    return machineCycleSeconds(line.product, outputLevel, capacityLevel) - CONFIG.phaseDurations.supply +
      sharedSpec('supply', this.state.shared.supply.level).serviceSeconds;
  }

  accelerate(lineId = this.state.selectedLineId) {
    const line = this.getLine(lineId);
    if (!line) return { ok: false, reason: 'invalid-line' };
    if (line.factory.phase === 'waiting-supply' &&
        cacheLoad(line) + line.factory.baseUnits > line.cacheCapacityBaseUnits) {
      return { ok: false, reason: 'waiting-cache' };
    }
    if (line.factory.phase !== 'processing') return { ok: false,
      reason: ['waiting-supply', 'waiting-cache'].includes(line.factory.phase) ? line.factory.phase : 'not-processing' };
    const seconds = Math.min(CONFIG.accelerateSeconds, line.factory.duration - line.factory.elapsed);
    line.factory.elapsed += seconds;
    const completed = line.factory.elapsed >= line.factory.duration - EPSILON;
    if (completed) this.finishPhase(line);
    return { ok: true, action: 'accelerate', lineId, product: line.product, seconds, completed };
  }

  capacityOffer(lineId = this.state.selectedLineId) {
    const line = this.getLine(lineId);
    if (!line) return null;
    const level = line.capacityLevel, maxed = level === CONFIG.maxCapacityLevel;
    const current = this.machineCycle(line, level);
    const next = this.machineCycle(line, maxed ? level : level + 1);
    return { lineId, product: line.product, level, maxed, cost: CONFIG.capacityUpgradeCost,
      affordable: !maxed && this.state.coins >= CONFIG.capacityUpgradeCost,
      currentCycleSeconds: current, nextCycleSeconds: next, machineCycleSeconds: current,
      processingSeconds: CONFIG.processingSeconds[level], nextProcessingSeconds: CONFIG.processingSeconds[maxed ? level : level + 1],
      batchUnits: batchUnits(line.outputLevel), speedGainPercent: Math.round((current / next - 1) * 100),
      pending: line.factory.batchId !== null && line.factory.capacityLevel !== level,
      sharedLimited: true, cacheLoadBaseUnits: cacheLoad(line), cacheCapacityBaseUnits: line.cacheCapacityBaseUnits };
  }

  upgradeCapacity(lineId = this.state.selectedLineId) {
    const line = this.getLine(lineId);
    if (!line) return { ok: false, reason: 'invalid-line' };
    const offer = this.capacityOffer(lineId);
    if (offer.maxed) return { ok: false, reason: 'capacity-max' };
    if (!offer.affordable) return { ok: false, reason: 'insufficient-coins' };
    this.state.coins -= offer.cost; line.capacityLevel++;
    this.refreshWaiting(line);
    return { ok: true, action: 'capacity-upgrade', lineId, product: line.product,
      cost: offer.cost, level: line.capacityLevel,
      oldCycleSeconds: offer.currentCycleSeconds, newCycleSeconds: offer.nextCycleSeconds };
  }

  outputOffer(lineId = this.state.selectedLineId) {
    const line = this.getLine(lineId);
    if (!line) return null;
    const f = line.factory, level = line.outputLevel, maxed = level === CONFIG.maxOutputLevel;
    const nextLevel = maxed ? level : level + 1, ratio = baseUnits(nextLevel) / baseUnits(level);
    const target = this.state.order.requirements.find(requirement => requirement.product === line.product)?.level || 5;
    const currentShots = 2 ** (target - level), nextShots = 2 ** (Math.max(target, nextLevel) - nextLevel);
    return { lineId, product: line.product, level, maxed, cost: CONFIG.outputUpgradeCost,
      affordable: !maxed && this.state.coins >= CONFIG.outputUpgradeCost,
      inventoryBefore: line.inventory, inventoryAfter: Math.floor(line.inventory / ratio),
      discardedBaseUnits: (line.inventory % ratio) * baseUnits(level),
      currentBatchLevel: f.outputLevel, currentBatchUnits: f.batchUnits,
      pending: !!line.legacyGroup, nextBatchUnits: batchUnits(nextLevel),
      cycleSeconds: this.machineCycle(line, line.capacityLevel, nextLevel),
      targetLevel: target, currentShots, nextShots, currentMerges: currentShots - 1, nextMerges: nextShots - 1,
      oldBatchCount: (line.legacyGroup?.batchIds.length || 0) + (line.legacyGroup?.completedBatches.length || 0) };
  }

  upgradeOutput(lineId = this.state.selectedLineId) {
    const line = this.getLine(lineId), offer = this.outputOffer(lineId);
    if (!offer) return { ok: false, reason: 'invalid-line' };
    if (offer.maxed) return { ok: false, reason: 'output-max' };
    if (!offer.affordable) return { ok: false, reason: 'insufficient-coins' };
    const from = this.launcherIndex(lineId);
    if (from < 0) return { ok: false, reason: 'missing-launcher' };
    const pending = [line.factory.batchId === null ? null : describeFactory(line), ...line.buffer].filter(Boolean);
    const completed = line.warehouse.filter(batch => !batch.credited).map(batchDescriptor);
    const oldGroup = line.legacyGroup;
    const material = offer.discardedBaseUnits + pending.reduce((sum, batch) => sum + batch.baseUnits, 0) +
      completed.reduce((sum, batch) => sum + batch.baseUnits, 0) + (oldGroup?.completedBaseUnits || 0);
    if (material > Number.MAX_SAFE_INTEGER - line.discardedBaseUnits) return { ok: false, reason: 'numeric-limit' };
    this.state.coins -= offer.cost; line.inventory = offer.inventoryAfter;
    line.discardedBaseUnits += offer.discardedBaseUnits; line.outputLevel++;
    line.legacyGroup = pending.length || completed.length || oldGroup ? {
      batchIds: [...new Set([...(oldGroup?.batchIds || []), ...pending.map(batch => batch.id)])],
      completedBaseUnits: (oldGroup?.completedBaseUnits || 0) + completed.reduce((sum, batch) => sum + batch.baseUnits, 0),
      completedBatches: [...(oldGroup?.completedBatches || []), ...completed]
    } : null;
    line.warehouse.forEach(batch => { batch.credited = true; });
    this.refreshWaiting(line); this.state.board[from].level = line.outputLevel;
    const minimum = Math.min(...this.state.lines.filter(candidate => candidate.product === line.product).map(candidate => candidate.outputLevel));
    for (const order of this.state.orders) {
      for (const requirement of order.requirements) {
        if (requirement.product === line.product) requirement.level = Math.max(requirement.level, minimum);
      }
    }
    this.settleLegacyGroup(line);
    return { ...offer, ok: true, action: 'output-upgrade', level: line.outputLevel,
      currentBatchLevel: line.factory.outputLevel, currentBatchUnits: line.factory.batchUnits, pending: !!line.legacyGroup };
  }

  launcherIndex(lineId = this.state.selectedLineId) {
    return this.state.board.findIndex(item => item && item.kind === 'launcher' && item.lineId === lineId);
  }

  select(index) {
    if (!isCell(index)) return { ok: false, reason: 'invalid-cell' };
    this.state.selectedCell = index;
    const item = this.state.board[index];
    if (item && item.kind === 'launcher') this.state.selectedLineId = item.lineId;
    return { ok: true, to: index };
  }

  setPage(page) {
    if (!['board', 'factory'].includes(page)) return { ok: false, reason: 'invalid-page' };
    this.state.page = page; return { ok: true };
  }

  launch(lineId = this.state.selectedLineId) {
    const line = this.getLine(lineId);
    if (!line) return { ok: false, reason: 'invalid-line' };
    const from = this.launcherIndex(lineId);
    if (from < 0) return { ok: false, reason: 'missing-launcher' };
    if (line.inventory < 1) return { ok: false, reason: 'empty-inventory' };
    const originRow = Math.floor(from / RULES.columns), originColumn = from % RULES.columns, candidates = [];
    this.state.board.forEach((item, index) => {
      if (item !== null) return;
      const dx = index % RULES.columns - originColumn, dy = Math.floor(index / RULES.columns) - originRow;
      const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
      candidates.push({ index, distance: dx * dx + dy * dy, angle });
    });
    if (!candidates.length) return { ok: false, reason: 'board-full' };
    if (this.state.nextItemId >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'numeric-limit' };
    candidates.sort((a, b) => a.distance - b.distance || a.angle - b.angle);
    const to = candidates[0].index, itemId = this.state.nextItemId++;
    this.state.board[to] = { kind: 'product', product: line.product, level: line.outputLevel, id: itemId };
    line.inventory--; this.state.selectedCell = from; this.state.selectedLineId = lineId;
    return { ok: true, action: 'launch', lineId, product: line.product, from, to, level: line.outputLevel, itemId };
  }

  drop(from, to) {
    if (!isCell(from) || !isCell(to)) return { ok: false, reason: 'invalid-cell' };
    const source = this.state.board[from];
    if (!source) return { ok: false, reason: 'empty-cell' };
    if (from === to) { this.select(to); return { ok: true, action: 'select', from, to, product: source.product, level: source.level }; }
    const target = this.state.board[to];
    if (target === null) {
      this.state.board[to] = source; this.state.board[from] = null; this.select(to);
      return { ok: true, action: 'move', from, to, product: source.product, level: source.level, itemId: source.id };
    }
    if (source.kind !== 'product' || target.kind !== 'product' || source.product !== target.product || source.level !== target.level) {
      return { ok: false, reason: 'incompatible' };
    }
    if (source.level >= RULES.maxLevel) return { ok: false, reason: 'max-level' };
    if (this.state.nextItemId >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'numeric-limit' };
    const level = source.level + 1, itemId = this.state.nextItemId++;
    this.state.board[to] = { kind: 'product', product: source.product, level, id: itemId };
    this.state.board[from] = null; this.state.selectedCell = to;
    return { ok: true, action: 'merge', from, to, product: source.product, level, itemId };
  }

  discard(index) {
    if (!isCell(index)) return { ok: false, reason: 'invalid-cell' };
    const item = this.state.board[index];
    if (!item) return { ok: false, reason: 'empty-cell' };
    if (item.kind === 'launcher') return { ok: false, reason: 'launcher-protected' };
    this.state.board[index] = null;
    return { ok: true, action: 'discard', from: index, product: item.product, level: item.level, itemId: item.id };
  }

  getOrder(orderId = this.state.focusedOrderId) {
    return this.state.orders.find(order => order.id === orderId) || null;
  }

  focusOrder(orderId) {
    const order = this.getOrder(orderId);
    if (!order) return { ok: false, action: 'order-focus', reason: 'order-not-found', orderId };
    this.state.focusedOrderId = order.id;
    this.state.order = order;
    return { ok: true, action: 'order-focus', orderId: order.id, slot: this.state.orders.indexOf(order) };
  }

  cycleOrder(offset) {
    if (!Number.isSafeInteger(offset)) return { ok: false, action: 'order-focus', reason: 'invalid-offset' };
    const index = this.state.orders.findIndex(order => order.id === this.state.focusedOrderId);
    const next = index + offset;
    if (next < 0 || next >= this.state.orders.length) return { ok: false, action: 'order-focus', reason: 'order-edge' };
    return this.focusOrder(this.state.orders[next].id);
  }

  customerServiceCount(customerId = CONFIG.currentCustomerId) {
    const count = this.state.customerServiceCounts[customerId];
    return isCount(count) ? count : 0;
  }

  orderProgress(orderId = this.state.focusedOrderId) {
    const order = this.getOrder(orderId);
    if (!order) return null;
    const requirements = order.requirements.map(requirement => {
      const ready = this.state.board.some(item => item && item.kind === 'product' &&
        item.product === requirement.product && item.level === requirement.level);
      const requiredBaseUnits = baseUnits(requirement.level);
      let availableBaseUnits = ready ? requiredBaseUnits : 0;
      if (!ready) {
        for (const item of this.state.board) {
          if (item && item.kind === 'product' && item.product === requirement.product && item.level <= requirement.level) {
            availableBaseUnits = Math.min(requiredBaseUnits, availableBaseUnits + baseUnits(item.level));
          }
          if (availableBaseUnits === requiredBaseUnits) break;
        }
        for (const line of this.state.lines) {
          if (line.product !== requirement.product || line.outputLevel > requirement.level) continue;
          const unitSize = baseUnits(line.outputLevel);
          const neededUnits = Math.ceil((requiredBaseUnits - availableBaseUnits) / unitSize);
          // Clamp the count before multiplication, since a long-running line
          // may have far more inventory than this one order can consume.
          const contribution = Math.min(line.inventory, neededUnits) * unitSize;
          availableBaseUnits = Math.min(requiredBaseUnits, availableBaseUnits + contribution);
        }
      }
      return { product: requirement.product, level: requirement.level, ready, boardUnits: ready ? 1 : 0,
        requiredBaseUnits, availableBaseUnits, missingBaseUnits: requiredBaseUnits - availableBaseUnits };
    });
    const ready = requirements.every(requirement => requirement.ready);
    return { orderId: order.id, ready,
      status: ready ? 'ready' : requirements.every(requirement => requirement.missingBaseUnits === 0) ? 'materials-ready' : 'missing-materials',
      requirements };
  }

  orderReady(orderId = this.state.focusedOrderId) {
    const order = this.getOrder(orderId);
    return Boolean(order && order.requirements.every(requirement => this.state.board.some(item =>
      item && item.kind === 'product' && item.product === requirement.product && item.level === requirement.level)));
  }

  deliver(orderId = this.state.focusedOrderId) {
    const order = this.getOrder(orderId);
    if (!order) return { ok: false, action: 'deliver', reason: 'order-not-found', orderId };
    if (!restoreOrder(order, this.state.lines)) return { ok: false, action: 'deliver', reason: 'invalid-order', orderId };
    const consumed = order.requirements.map(requirement => ({ index: this.state.board.findIndex(item =>
      item && item.kind === 'product' && item.product === requirement.product && item.level === requirement.level),
      product: requirement.product, level: requirement.level }));
    if (consumed.some(item => item.index < 0)) return { ok: false, action: 'deliver', reason: 'order-not-ready', orderId };
    const customerId = CONFIG.currentCustomerId;
    const serviceCount = this.customerServiceCount(customerId);
    if (!isCount(this.state.coins) || !isCount(this.state.completedOrders) ||
        !isCount(this.state.customerServiceCounts[customerId]) || serviceCount !== this.state.completedOrders ||
        !Number.isSafeInteger(this.state.coins + order.reward) || !isId(this.state.nextOrderId) ||
        this.state.nextOrderId !== this.state.completedOrders + CONFIG.parallelOrderSlots + 1 ||
        this.state.orders.some(candidate => candidate.id >= this.state.nextOrderId) ||
        !Number.isSafeInteger(this.state.nextOrderId + 1) || !Number.isSafeInteger(this.state.completedOrders + 1) ||
        !Number.isSafeInteger(serviceCount + 1)) {
      return { ok: false, action: 'deliver', reason: 'numeric-limit', orderId };
    }
    const slot = this.state.orders.indexOf(order);
    const retained = this.state.orders.filter(candidate => candidate.id !== order.id);
    const replacement = makeOrder(this.state.nextOrderId, this.state.lines, !hasQuickOrder(retained));
    for (const item of consumed) this.state.board[item.index] = null;
    this.state.coins += order.reward; this.state.completedOrders++;
    this.state.customerServiceCounts[customerId] = serviceCount + 1;
    this.state.nextOrderId++;
    this.state.orders[slot] = replacement;
    if (this.state.focusedOrderId === order.id) this.state.focusedOrderId = replacement.id;
    this.state.order = this.getOrder();
    if (consumed.some(item => item.index === this.state.selectedCell)) this.state.selectedCell = this.launcherIndex();
    return { ok: true, action: 'deliver', from: consumed[0].index, level: consumed[0].level,
      consumed, reward: order.reward, orderId: order.id, slot, newOrderId: replacement.id,
      customerId, customerServiceCount: serviceCount + 1 };
  }

  serialize(nowMs) {
    if (nowMs !== undefined) {
      const result = this.advanceProduction(nowMs);
      if (!result.ok) throw new Error(result.reason);
    }
    return JSON.parse(JSON.stringify(this.state));
  }
}

module.exports = { GameModel, RULES };

