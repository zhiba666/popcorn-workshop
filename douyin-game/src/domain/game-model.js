'use strict';

const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS, getBatchSpec, machineCycleSeconds,
  cacheCapacityBaseUnits, materialSpecification, processingSeconds, factoryPhaseSeconds } = require('./production/production-config');
const { CUSTOMERS, getCustomer, getProgress, thresholds, CUSTOMER_BASE_REWARD } = require('./customers/customer-config');
const { createBoardRules } = require('./board/board-rules');
const PRODUCTS = CONFIG.products;
const LINE_IDS = Object.freeze(CONFIG.lines.map(line => line.id));
const LEGACY_PRODUCTS = Object.freeze(['original', 'caramel']);
const LEGACY_LINE_IDS = Object.freeze(['original-1', 'caramel-1']);
const SCHEMA_SEVEN_PRODUCTS = Object.freeze(['original', 'caramel', 'popcorn-ball']);
const SCHEMA_EIGHT_PRODUCTS = Object.freeze(['original', 'caramel', 'popcorn-ball', 'crisp-stick']);
const SCHEMA_NINE_PRODUCTS = Object.freeze(['original', 'caramel', 'popcorn-ball', 'crisp-stick', 'wafer']);
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
const BOARD_RULES = createBoardRules(RULES);

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

function minimumOutputLevel(lines, product) {
  return Math.min(...lines.filter(line => line.product === product).map(line => line.outputLevel));
}

function orderTargetLevel(lines, product, level, quick = false) {
  const outputLevels = lines.filter(line => line.product === product).map(line => line.outputLevel);
  return Math.min(RULES.maxLevel, quick ? Math.max(level, Math.min(...outputLevels)) :
    level + Math.max(...outputLevels) - 1);
}

function sharedSpec(service, level, stage = 2) {
  if (!['supply', 'packaging'].includes(service) || !Number.isInteger(level) ||
      level < 1 || level > CONFIG.maxSharedLevel) return null;
  const specification = CONFIG.sharedServiceSpecs[service][level];
  const multiplier = CONFIG.sharedStageMultipliers[stage];
  if (!specification || !multiplier) return null;
  return Object.fromEntries(Object.entries(specification).map(([key, value]) => [key, value * multiplier]));
}

function productionStage(lines) {
  return Math.max(...lines.map(line => PRODUCT_DEFINITIONS[line.product].generation));
}

function validSharedDuration(service, level, duration, key = 'serviceSeconds', stage = 2, earliestStage = 1) {
  for (let previousStage = earliestStage; previousStage <= stage; previousStage++) {
    for (let candidate = 1; candidate <= level; candidate++) {
      if (sharedSpec(service, candidate, previousStage)[key] === duration) return true;
    }
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

function makeOrder(id, lines, quick = false, preferredProduct = null) {
  const opening = [
    { products: ['original'], level: 3, reward: 60 },
    { products: ['caramel'], level: 3, reward: 70 },
    { products: LEGACY_PRODUCTS, level: 3, reward: 150 },
    { products: ['popcorn-ball'], level: 3, reward: 80 },
    { products: ['crisp-stick'], level: 3, reward: 90 },
    { products: ['wafer'], level: 3, reward: 100 },
    { products: ['sandwich-square'], level: 3, reward: 110 }
  ];
  const cycle = [
    { products: ['original'], level: 4, reward: 110 },
    { products: ['caramel'], level: 4, reward: 120 },
    { products: LEGACY_PRODUCTS, level: 4, reward: 240 },
    { products: ['original'], level: 5, reward: 180 },
    { products: ['caramel'], level: 5, reward: 190 },
    { products: LEGACY_PRODUCTS, level: 5, reward: 380 },
    { products: ['popcorn-ball'], level: 4, reward: 130 },
    { products: ['original', 'popcorn-ball'], level: 4, reward: 250 },
    { products: ['caramel', 'popcorn-ball'], level: 4, reward: 260 },
    { products: ['popcorn-ball'], level: 5, reward: 200 },
    { products: ['original', 'popcorn-ball'], level: 5, reward: 390 },
    { products: ['caramel', 'popcorn-ball'], level: 5, reward: 400 },
    { products: ['crisp-stick'], level: 4, reward: 140 },
    { products: ['original', 'crisp-stick'], level: 4, reward: 260 },
    { products: ['caramel', 'crisp-stick'], level: 4, reward: 270 },
    { products: ['popcorn-ball', 'crisp-stick'], level: 4, reward: 280 },
    { products: ['crisp-stick'], level: 5, reward: 210 },
    { products: ['original', 'crisp-stick'], level: 5, reward: 400 },
    { products: ['caramel', 'crisp-stick'], level: 5, reward: 410 },
    { products: ['popcorn-ball', 'crisp-stick'], level: 5, reward: 420 },
    { products: ['wafer'], level: 4, reward: 150 },
    { products: ['original', 'wafer'], level: 4, reward: 270 },
    { products: ['caramel', 'wafer'], level: 4, reward: 280 },
    { products: ['popcorn-ball', 'wafer'], level: 4, reward: 290 },
    { products: ['crisp-stick', 'wafer'], level: 4, reward: 300 },
    { products: ['wafer'], level: 5, reward: 220 },
    { products: ['original', 'wafer'], level: 5, reward: 410 },
    { products: ['caramel', 'wafer'], level: 5, reward: 420 },
    { products: ['popcorn-ball', 'wafer'], level: 5, reward: 430 },
    { products: ['crisp-stick', 'wafer'], level: 5, reward: 440 },
    { products: ['sandwich-square'], level: 4, reward: 160 },
    { products: ['original', 'sandwich-square'], level: 4, reward: 280 },
    { products: ['caramel', 'sandwich-square'], level: 4, reward: 290 },
    { products: ['popcorn-ball', 'sandwich-square'], level: 4, reward: 300 },
    { products: ['crisp-stick', 'sandwich-square'], level: 4, reward: 310 },
    { products: ['wafer', 'sandwich-square'], level: 4, reward: 320 },
    { products: ['sandwich-square'], level: 5, reward: 230 },
    { products: ['original', 'sandwich-square'], level: 5, reward: 420 },
    { products: ['caramel', 'sandwich-square'], level: 5, reward: 430 },
    { products: ['popcorn-ball', 'sandwich-square'], level: 5, reward: 440 },
    { products: ['crisp-stick', 'sandwich-square'], level: 5, reward: 450 },
    { products: ['wafer', 'sandwich-square'], level: 5, reward: 460 }
  ];
  const availableProducts = PRODUCTS.filter(product => lines.some(line => line.product === product));
  const available = candidate => candidate.products.every(product => availableProducts.includes(product));
  const openingChoices = availableProducts.length === 1 ?
    [...opening, ...cycle].filter(candidate => available(candidate) && candidate.products.length === 1) : opening.filter(available);
  const cycleChoices = cycle.filter(available);
  const quickProduct = availableProducts.includes(preferredProduct) ? preferredProduct :
    availableProducts[(id - 1) % availableProducts.length];
  const spec = quick || preferredProduct ? opening.find(candidate => candidate.products.length === 1 && candidate.products[0] === quickProduct) :
    id <= openingChoices.length ? openingChoices[id - 1] : cycleChoices[(id - openingChoices.length - 1) % cycleChoices.length];
  const simple = quick || preferredProduct || id <= openingChoices.length;
  const requirements = spec.products.map(product => ({ product,
    level: orderTargetLevel(lines, product, spec.level, simple) }));
  const rewardScale = 2 ** Math.max(...requirements.map(requirement => requirement.level - spec.level));
  return {
    id, kind: 'normal',
    customerId: CONFIG.currentCustomerId,
    requirements,
    reward: spec.reward * rewardScale
  };
}

function hasQuickOrder(orders, lines) {
  return orders.some(order => order.requirements.length === 1 &&
    order.requirements[0].level <= Math.max(3, minimumOutputLevel(lines, order.requirements[0].product)));
}

function createCustomerState(completedOrders = 0) {
  const customerServiceCounts = Object.fromEntries(CUSTOMERS.map(customer => [customer.id,
    customer.id === CONFIG.currentCustomerId ? completedOrders : 0]));
  return {
    customerServiceCounts,
    customerSuperOrderCounts: Object.fromEntries(CUSTOMERS.map(customer => [customer.id, 0])),
    customerPaidGifts: Object.fromEntries(CUSTOMERS.map(customer => [customer.id, {}])),
    customerReadSuperOrders: Object.fromEntries(CUSTOMERS.map(customer => [customer.id, 0])),
    customerCollectedRead: Object.fromEntries(CUSTOMERS.map(customer => [customer.id, customerServiceCounts[customer.id] > 0])),
    customerRefillCount: 0, customerWaitingQueue: [], customerMaxQueue: [],
    customerLastVisit: Object.fromEntries(CUSTOMERS.map(customer => [customer.id, 0]))
  };
}

function createOrderBook(order, lines, completedOrders, initial = false) {
  order = { ...order, kind: 'normal', customerId: order.customerId || CONFIG.currentCustomerId };
  const orders = [order];
  let nextOrderId = order.id + 1;
  while (orders.length < CONFIG.parallelOrderSlots) {
    const customer = initial ? CUSTOMERS[orders.length] : null;
    orders.push({ ...makeOrder(nextOrderId++, lines, initial || !hasQuickOrder(orders, lines), customer == null ? undefined : customer.primaryProduct),
      customerId: (customer == null ? undefined : customer.id) || CONFIG.currentCustomerId });
  }
  const customerState = createCustomerState(completedOrders);
  for (const visiting of orders) customerState.customerLastVisit[visiting.customerId] =
    Math.max(customerState.customerLastVisit[visiting.customerId], visiting.id);
  return { orders, superOrder: null,
    focusedOrderId: order.id, nextOrderId, order, ...customerState };
}

function customerEligible(customer, firstStockedProducts) {
  return customer.generation === 1 || firstStockedProducts.includes(customer.primaryProduct);
}

function restoreCustomerState(saved, orders, legacy) {
  if (legacy === true) {
    if (!isRecord(saved.customerServiceCounts) || Object.keys(saved.customerServiceCounts).length !== 1 ||
        saved.customerServiceCounts[CONFIG.currentCustomerId] !== saved.completedOrders) return null;
    const migrated = createCustomerState(saved.completedOrders);
    for (const order of orders) migrated.customerLastVisit[order.customerId] =
      Math.max(migrated.customerLastVisit[order.customerId], order.id);
    return migrated;
  }
  const serviceStars = legacy === 'services';
  const maps = ['customerServiceCounts', 'customerPaidGifts', 'customerLastVisit',
    ...(serviceStars ? ['customerReadServices'] : ['customerSuperOrderCounts',
      'customerReadSuperOrders', 'customerCollectedRead'])];
  if (maps.some(key => !isRecord(saved[key]) || Object.keys(saved[key]).length !== CUSTOMERS.length ||
      Object.keys(saved[key]).some(id => !getCustomer(id))) || !isCount(saved.customerRefillCount) ||
      saved.customerRefillCount > saved.completedOrders) return null;
  let total = 0;
  const state = { ...createCustomerState(), customerRefillCount: saved.customerRefillCount };
  for (const key of maps) state[key] = {};
  for (const customer of CUSTOMERS) {
    const id = customer.id, services = saved.customerServiceCounts[id];
    const completed = serviceStars ? 0 : saved.customerSuperOrderCounts[id];
    const read = serviceStars ? saved.customerReadServices[id] : saved.customerReadSuperOrders[id];
    const lastVisit = saved.customerLastVisit[id], gifts = saved.customerPaidGifts[id];
    const stars = getProgress(serviceStars ? services : completed).stars;
    if (!isCount(services) || !isCount(completed) || completed > 16 || services < completed ||
        !isCount(read) || read > (serviceStars ? services : completed) || !isCount(lastVisit) ||
        lastVisit >= saved.nextOrderId || !isRecord(gifts) ||
        (serviceStars && Object.keys(gifts).length !== stars) ||
        Object.entries(gifts).some(([star, reward]) => !/^[1-5]$/.test(star) || !isCount(reward) ||
          Number(star) > stars && (serviceStars || services < thresholds[Number(star) - 1])) ||
        thresholds.slice(0, stars).some((threshold, index) => !Object.prototype.hasOwnProperty.call(gifts, index + 1)) ||
        (!serviceStars && (typeof saved.customerCollectedRead[id] !== 'boolean' ||
          !services && saved.customerCollectedRead[id])) ||
        (services > 0 || orders.some(order => order.customerId === id)) && !customerEligible(customer, saved.firstStockedProducts)) return null;
    total += services;
    if (!Number.isSafeInteger(total)) return null;
    state.customerServiceCounts[id] = services; state.customerPaidGifts[id] = { ...gifts };
    state.customerSuperOrderCounts[id] = completed;
    state.customerReadSuperOrders[id] = serviceStars ? 0 : read;
    state.customerCollectedRead[id] = serviceStars ? read > 0 : saved.customerCollectedRead[id];
    state.customerLastVisit[id] = lastVisit;
  }
  delete state.customerReadServices;
  if (total !== saved.completedOrders ||
      orders.some(order => state.customerLastVisit[order.customerId] < order.id)) return null;
  for (const key of ['customerWaitingQueue', 'customerMaxQueue']) {
    const queue = saved[key];
    if (!Array.isArray(queue) || new Set(queue).size !== queue.length || queue.some(id => {
      const customer = getCustomer(id), services = state.customerServiceCounts[id];
      if (!customer || !customerEligible(customer, saved.firstStockedProducts)) return true;
      const stars = getProgress(serviceStars ? services : state.customerSuperOrderCounts[id]).stars;
      return key === 'customerWaitingQueue' ? !services || stars === 5 || orders.some(order => order.customerId === id) : stars !== 5;
    })) return null;
    state[key] = [...queue];
  }
  if (serviceStars) {
    const queues = customerQueues({ ...saved, ...state }, orders, state.customerServiceCounts);
    state.customerWaitingQueue = queues.regular; state.customerMaxQueue = queues.max;
  }
  return state;
}

function restoreOrder(saved, lines, legacyCustomer = false) {
  if (!isRecord(saved) || !isId(saved.id) || !isId(saved.reward) ||
      !(saved.kind === 'normal' || saved.kind === undefined) ||
      !(getCustomer(saved.customerId) || legacyCustomer && saved.customerId === undefined) ||
      !Array.isArray(saved.requirements) || !saved.requirements.length || saved.requirements.length > PRODUCTS.length) return null;
  const requirements = [];
  for (const requirement of saved.requirements) {
    if (!isRecord(requirement)) return null;
    const productLines = lines.filter(line => line.product === requirement.product);
    if (!productLines.length || requirements.some(other => other.product === requirement.product) ||
        !Number.isInteger(requirement.level) || requirement.level < 1 || requirement.level > RULES.maxLevel) return null;
    requirements.push({ product: requirement.product, level: requirement.level });
  }
  return { id: saved.id, kind: 'normal', customerId: saved.customerId || CONFIG.currentCustomerId, reward: saved.reward, requirements };
}

function sameOrder(left, right) {
  return left.id === right.id && left.kind === right.kind && left.customerId === right.customerId && left.reward === right.reward && left.requirements.length === right.requirements.length &&
    left.requirements.every((requirement, index) => requirement.product === right.requirements[index].product &&
      requirement.level === right.requirements[index].level);
}

function customerQueues(state, orders, counts) {
  const waiting = customer => customerEligible(customer, state.firstStockedProducts) &&
    counts[customer.id] > 0 && getProgress(state.customerSuperOrderCounts[customer.id]).stars < 5 &&
    !orders.some(order => order.customerId === customer.id);
  const regular = state.customerWaitingQueue.filter(id => waiting(getCustomer(id)));
  for (const customer of CUSTOMERS) if (waiting(customer) && !regular.includes(customer.id)) regular.push(customer.id);
  const max = state.customerMaxQueue.filter(id => getProgress(state.customerSuperOrderCounts[id]).stars === 5);
  for (const customer of CUSTOMERS) if (getProgress(state.customerSuperOrderCounts[customer.id]).stars === 5 && !max.includes(customer.id)) max.push(customer.id);
  return { regular, max };
}

function sameRequirements(left, right) {
  return left.requirements.length === right.requirements.length && left.requirements.every(requirement =>
    right.requirements.some(other => other.product === requirement.product && other.level === requirement.level));
}

function makeCustomerOrder(state, customer, retained, counts) {
  const lines = state.lines.filter(line => line.product === 'original' || state.firstStockedProducts.includes(line.product));
  if (!lines.some(line => line.product === customer.primaryProduct)) return null;
  const preferences = [customer.primaryProduct, customer.secondaryProduct].filter(product =>
    product && lines.some(line => line.product === product));
  const firstVisit = counts[customer.id] === 0, quick = !hasQuickOrder(retained, lines);
  const candidates = [];
  // First visits establish the new product. Repeat visits retain the existing
  // authored order economics while requiring at least one supplied preference.
  if (!firstVisit) for (let offset = 0; offset < 48; offset++) {
    const candidate = makeOrder(state.nextOrderId + offset, lines, quick);
    if (candidate.requirements.some(requirement => preferences.includes(requirement.product))) candidates.push(candidate);
  }
  for (const product of firstVisit ? [customer.primaryProduct] : preferences) {
    const candidate = makeOrder(state.nextOrderId, lines, true, product);
    candidates.push(candidate);
    for (const level of [4, 5]) candidates.push({ ...candidate,
      requirements: candidate.requirements.map(requirement => ({ ...requirement,
        level: orderTargetLevel(lines, requirement.product, level) })),
      reward: (candidate.reward + (level === 4 ? 50 : 120)) *
        2 ** (orderTargetLevel(lines, product, level) - Math.max(level, candidate.requirements[0].level)) });
  }
  const candidate = candidates.find(candidate => !retained.some(order => order.customerId === customer.id && sameRequirements(order, candidate)));
  return candidate ? { ...candidate, id: state.nextOrderId, customerId: customer.id } : null;
}

function nextCustomerOrder(state, retained, counts) {
  const queues = customerQueues(state, retained, counts);
  const available = CUSTOMERS.filter(customer => customerEligible(customer, state.firstStockedProducts));
  const absent = available.filter(customer => !retained.some(order => order.customerId === customer.id));
  const ordered = ids => ids.map(getCustomer).filter(customer => absent.includes(customer));
  const regular = ordered(queues.regular), max = ordered(queues.max);
  const fresh = absent.filter(customer => !counts[customer.id]);
  const byWait = [...absent].sort((left, right) => state.customerLastVisit[left.id] - state.customerLastVisit[right.id] ||
    CUSTOMERS.indexOf(left) - CUSTOMERS.indexOf(right));
  const slot = state.customerRefillCount % 4;
  const reservedMax = slot === 3 && (Math.floor(state.customerRefillCount / 4) + 1) % 3 === 0;
  const choices = slot === 1 ? [...fresh, ...regular, ...max] : slot === 3 ?
    [...(reservedMax ? max : []), ...byWait] : [...regular, ...fresh, ...max];
  for (const customer of [...new Set(choices)]) {
    const order = makeCustomerOrder(state, customer, retained, counts);
    if (order) return { order, queues };
  }
  // Duplicate visitors are a fallback only after all idle valid customers
  // have been tried. Distinct targets keep two orders independently useful.
  for (const customer of available.filter(customer => !absent.includes(customer))) {
    const order = makeCustomerOrder(state, customer, retained, counts);
    if (order) return { order, queues };
  }
  return null;
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
  if (!Array.isArray(saved.lines) || saved.lines.length !== LEGACY_PRODUCTS.length ||
      !LEGACY_LINE_IDS.includes(saved.selectedLineId)) return null;
  const lines = [];
  for (let index = 0; index < LEGACY_PRODUCTS.length; index += 1) {
    const line = saved.lines[index];
    if (!isRecord(line) || line.id !== LEGACY_LINE_IDS[index] || line.product !== LEGACY_PRODUCTS[index] ||
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
      saved.order.requirements.length < 1 || saved.order.requirements.length > LEGACY_PRODUCTS.length ||
      !isId(saved.order.reward)) return null;
  const requirements = [];
  for (const requirement of saved.order.requirements) {
    if (!isRecord(requirement) || !LEGACY_PRODUCTS.includes(requirement.product) ||
        requirements.some(other => other.product === requirement.product) ||
        !Number.isInteger(requirement.level) || requirement.level < 1 || requirement.level > RULES.maxLevel) return null;
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

const SCHEMA_VERSION = 12;

function createFactory(line, rotaryPasses = line.factory ? line.factory.rotaryPasses : 3) {
  const spec = getBatchSpec(line.product, line.outputLevel, line.capacityLevel);
  return {
    phase: 'waiting-supply', elapsed: 0, duration: 0, batchId: null,
    outputLevel: line.outputLevel, capacityLevel: line.capacityLevel,
    batchUnits: spec.batchUnits, baseUnits: spec.baseUnits,
    ...(line.product === 'sandwich-square' && rotaryPasses !== undefined ? { rotaryPasses } : {})
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
    firstStockedProducts: [], pendingProductOrders: [],
    coins: 0, completedOrders: 0, page: 'board', selectedCell: initialDefinitions[0].launcherCell,
    selectedLineId: lines[0].id, board, lines, ...createOrderBook(makeOrder(1, lines), lines, 0, true), nextItemId: lines.length + 1,
    shared: {
      materials: { baseUnits: CONFIG.materialRefillBaseUnits, capacityBaseUnits: CONFIG.materialCapacityBaseUnits,
        elapsed: 0, duration: sharedSpec('supply', 1, 1).refillSeconds, refillBaseUnits: CONFIG.materialRefillBaseUnits, refilledBaseUnits: 0 },
      supply: { level: 1, lineId: null, elapsed: 0, duration: sharedSpec('supply', 1, 1).serviceSeconds, queue: lines.map(line => line.id) },
      packaging: { level: 1, lineId: null, batch: null, elapsed: 0, duration: sharedSpec('packaging', 1, 1).serviceSeconds, queue: [] }
    }
  };
}

function upgradeLegacyState(saved) {
  const state = { ...saved, schemaVersion: SCHEMA_VERSION, productionAt: null, nextBatchId: 1,
    firstStockedProducts: [...LEGACY_PRODUCTS], pendingProductOrders: [] };
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

function restoreProductionState(saved, allowLegacyOrderBook = false, legacyCustomers = false) {
  if (!isRecord(saved)) return null;
  if (saved.schemaVersion === 11) {
    // Ordinary service history remains collected, but never counts as a
    // completed super order. Previously settled gifts stay settled.
    return restoreProductionState({ ...saved, schemaVersion: SCHEMA_VERSION }, false, 'services');
  }
  if (saved.schemaVersion === 10) {
    return restoreProductionState({ ...saved, schemaVersion: SCHEMA_VERSION }, false, true);
  }
  if (saved.schemaVersion === 9) {
    // Version nine owns only the first five products. Keep their exact saved
    // state and introductory orders without granting the final workshop.
    if (!Array.isArray(saved.lines) || saved.lines.some(line => !SCHEMA_NINE_PRODUCTS.includes(line == null ? undefined : line.product)) ||
        !Array.isArray(saved.firstStockedProducts) || saved.firstStockedProducts.some(product => !SCHEMA_NINE_PRODUCTS.includes(product)) ||
        !Array.isArray(saved.pendingProductOrders) || saved.pendingProductOrders.some(product => !SCHEMA_NINE_PRODUCTS.includes(product))) return null;
    return restoreProductionState({ ...saved, schemaVersion: SCHEMA_VERSION }, false, true);
  }
  if (saved.schemaVersion === 8) {
    // Version eight has no thin-wafer workshop. Migrate only its four known
    // products, preserving all existing production and order state.
    if (!Array.isArray(saved.lines) || saved.lines.some(line => !SCHEMA_EIGHT_PRODUCTS.includes(line == null ? undefined : line.product)) ||
        !Array.isArray(saved.firstStockedProducts) || saved.firstStockedProducts.some(product => !SCHEMA_EIGHT_PRODUCTS.includes(product)) ||
        !Array.isArray(saved.pendingProductOrders) || saved.pendingProductOrders.some(product => !SCHEMA_EIGHT_PRODUCTS.includes(product))) return null;
    return restoreProductionState({ ...saved, schemaVersion: SCHEMA_VERSION }, false, true);
  }
  if (saved.schemaVersion === 7) {
    // Version seven owns at most the first three products. Retain its batches,
    // paid levels, active timings, milestones and introductory order queue.
    if (!Array.isArray(saved.lines) || saved.lines.some(line => !SCHEMA_SEVEN_PRODUCTS.includes(line == null ? undefined : line.product)) ||
        !Array.isArray(saved.firstStockedProducts) || saved.firstStockedProducts.some(product => !SCHEMA_SEVEN_PRODUCTS.includes(product)) ||
        !Array.isArray(saved.pendingProductOrders) || saved.pendingProductOrders.some(product => !SCHEMA_SEVEN_PRODUCTS.includes(product))) return null;
    return restoreProductionState({ ...saved, schemaVersion: SCHEMA_VERSION }, false, true);
  }
  if (saved.schemaVersion === 6) {
    // Version six can contain only the first two products. Keep its precise
    // milestone and pending introductory order without awarding a new product.
    if (!Array.isArray(saved.lines) || saved.lines.some(line => !LEGACY_PRODUCTS.includes(line == null ? undefined : line.product)) ||
        !(saved.pendingProductOrder === null || saved.pendingProductOrder === 'caramel') ||
        !Array.isArray(saved.firstStockedProducts) || saved.firstStockedProducts.some(product => !LEGACY_PRODUCTS.includes(product))) return null;
    return restoreProductionState({ ...saved, schemaVersion: SCHEMA_VERSION,
      pendingProductOrders: saved.pendingProductOrder === null ? [] : [saved.pendingProductOrder] }, false, true);
  }
  if (saved.schemaVersion === 5) {
    // Existing players keep both products and their exact public capacity.
    // Old saves cannot prove first-stock history after their stock was spent.
    if (!Array.isArray(saved.lines) || saved.lines.some(line => !LEGACY_PRODUCTS.includes(line == null ? undefined : line.product)) ||
        LEGACY_LINE_IDS.some(id => !saved.lines.some(line => (line == null ? undefined : line.id) === id)) ||
        !isRecord(saved.shared) || !isRecord(saved.shared.supply) || !isRecord(saved.shared.packaging)) return null;
    const hasSupplyLevel = Object.prototype.hasOwnProperty.call(saved.shared.supply, 'level');
    const hasPackagingLevel = Object.prototype.hasOwnProperty.call(saved.shared.packaging, 'level');
    if (hasSupplyLevel !== hasPackagingLevel) return null;
    const supplyLevel = hasSupplyLevel ? saved.shared.supply.level : 1;
    const packagingLevel = hasPackagingLevel ? saved.shared.packaging.level : 1;
    if (!sharedSpec('supply', supplyLevel) || !sharedSpec('packaging', packagingLevel) ||
        !isRecord(saved.shared.materials) ||
        !validSharedDuration('supply', supplyLevel, saved.shared.supply.duration, 'serviceSeconds', 2, 2) ||
        !validSharedDuration('supply', supplyLevel, saved.shared.materials.duration, 'refillSeconds', 2, 2) ||
        !validSharedDuration('packaging', packagingLevel, saved.shared.packaging.duration, 'serviceSeconds', 2, 2)) return null;
    return restoreProductionState({ ...saved, schemaVersion: SCHEMA_VERSION,
      firstStockedProducts: [...LEGACY_PRODUCTS], pendingProductOrders: [],
      shared: { ...saved.shared,
        supply: { ...saved.shared.supply, level: supplyLevel },
        packaging: { ...saved.shared.packaging, level: packagingLevel } } }, true, true);
  }
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
    return restoreProductionState(migrated, true, true);
  }
  if (!isCount(saved.coins) || !isCount(saved.completedOrders) ||
      !['board', 'factory', 'customers'].includes(saved.page) || !isCell(saved.selectedCell) ||
      !isId(saved.nextItemId) || !isId(saved.nextBatchId) ||
      (saved.productionAt !== null && !isCount(saved.productionAt)) ||
      !Array.isArray(saved.lines) || !isRecord(saved.shared)) return null;
  if (!isRecord(saved.shared.supply) || !isRecord(saved.shared.packaging)) return null;
  const hasSupplyLevel = Object.prototype.hasOwnProperty.call(saved.shared.supply, 'level');
  const hasPackagingLevel = Object.prototype.hasOwnProperty.call(saved.shared.packaging, 'level');
  if (!hasSupplyLevel || !hasPackagingLevel) return null;
  const levels = { supply: hasSupplyLevel ? saved.shared.supply.level : 1,
    packaging: hasPackagingLevel ? saved.shared.packaging.level : 1 };
  if (!sharedSpec('supply', levels.supply) || !sharedSpec('packaging', levels.packaging)) return null;
  const lines = [], physicalIds = new Set();
  const claimBatch = batch => {
    if (!batch || physicalIds.has(batch.id) || batch.id >= saved.nextBatchId) return false;
    physicalIds.add(batch.id); return true;
  };
  for (const previous of saved.lines) {
    const definition = CONFIG.lines.find(line => line.id === (previous == null ? undefined : previous.id));
    if (!definition || lines.some(line => line.id === definition.id) || previous.product !== definition.product ||
        !isOutputLevel(previous.outputLevel) || !isCapacityLevel(previous.capacityLevel) ||
        !isCount(previous.inventory) || !isCount(previous.discardedBaseUnits) ||
        previous.cacheCapacityBaseUnits !== cacheCapacityBaseUnits(previous.outputLevel) ||
        !Array.isArray(previous.buffer) || !Array.isArray(previous.warehouse) || !isRecord(previous.factory)) return null;
    const line = { id: previous.id, product: previous.product, outputLevel: previous.outputLevel,
      capacityLevel: previous.capacityLevel, inventory: previous.inventory,
      discardedBaseUnits: previous.discardedBaseUnits, cacheCapacityBaseUnits: previous.cacheCapacityBaseUnits,
      factory: null, buffer: [], warehouse: [], legacyGroup: null };
    const f = previous.factory, spec = getBatchSpec(line.product, f.outputLevel, f.capacityLevel);
    if (!FACTORY_PHASES.includes(f.phase) || !spec || f.outputLevel > line.outputLevel ||
        f.capacityLevel > line.capacityLevel || f.batchUnits !== spec.batchUnits || f.baseUnits !== spec.baseUnits ||
        !Number.isFinite(f.elapsed) || f.elapsed < 0) return null;
    if (f.rotaryPasses !== undefined &&
        (line.product !== 'sandwich-square' || ![1, 3].includes(f.rotaryPasses))) return null;
    const duration = f.phase === 'supply' ? saved.shared.supply.duration :
      MAIN_PHASES.includes(f.phase) ? factoryPhaseSeconds(line.product, f, f.phase) : 0;
    if (f.duration !== duration || (duration ? f.elapsed >= duration : f.elapsed !== 0)) return null;
    if (f.phase === 'waiting-supply') {
      if (f.batchId !== null || f.outputLevel !== line.outputLevel || f.capacityLevel !== line.capacityLevel) return null;
    } else if (!claimBatch(restoreBatch({ ...f, id: f.batchId, lineId: line.id, product: line.product }, line))) return null;
    line.factory = { phase: f.phase, elapsed: f.elapsed, duration: f.duration, batchId: f.batchId,
      outputLevel: f.outputLevel, capacityLevel: f.capacityLevel, batchUnits: f.batchUnits, baseUnits: f.baseUnits,
      ...(f.rotaryPasses !== undefined ? { rotaryPasses: f.rotaryPasses } : {}) };
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
    if (productLines.length > CONFIG.maxLinesPerProduct ||
        productLines.some((_, index) => !productLines.some(line => line.id === `${product}-${index + 1}`))) return null;
    const previousProduct = PRODUCTS[PRODUCTS.indexOf(product) - 1];
    if (productLines.length && previousProduct && !lines.some(line => line.product === previousProduct)) return null;
  }
  const stage = productionStage(lines);
  if (!Array.isArray(saved.firstStockedProducts) ||
      new Set(saved.firstStockedProducts).size !== saved.firstStockedProducts.length ||
      saved.firstStockedProducts.some(product => !PRODUCTS.includes(product) || !lines.some(line => line.product === product)) ||
      !Array.isArray(saved.pendingProductOrders) ||
      new Set(saved.pendingProductOrders).size !== saved.pendingProductOrders.length ||
      saved.pendingProductOrders.some((product, index, pending) => !PRODUCTS.slice(1).includes(product) ||
        !lines.some(line => line.product === product) || (index > 0 && PRODUCTS.indexOf(pending[index - 1]) >= PRODUCTS.indexOf(product)))) return null;
  // Array order is presentation data; ties in scheduling use configured line
  // order so reordering a saved array cannot change production allocation.
  lines.sort(configuredLineOrder);
  const completedIds = new Set();
  for (const line of lines) {
    const group = line.legacyGroup;
    for (const batch of (group == null ? undefined : group.completedBatches) || []) {
      if (completedIds.has(batch.id)) return null;
      completedIds.add(batch.id);
      if (physicalIds.has(batch.id) && !line.warehouse.some(transit =>
        transit.id === batch.id && transit.credited)) return null;
    }
    const pendingBaseUnits = (line.factory.batchId === null ? 0 : line.factory.baseUnits) + cacheLoad(line) +
      line.warehouse.reduce((sum, batch) => sum + (batch.credited ? 0 : batch.baseUnits), 0) +
      ((group == null ? undefined : group.completedBaseUnits) || 0);
    if (!Number.isSafeInteger(pendingBaseUnits) ||
        !Number.isSafeInteger(line.inventory + Math.floor(pendingBaseUnits / baseUnits(line.outputLevel))) ||
        !Number.isSafeInteger(line.discardedBaseUnits + pendingBaseUnits)) return null;
  }
  const boardResult = restoreBoard(saved.board, lines);
  if (!boardResult || saved.nextItemId <= boardResult.largestId) return null;
  if (lines.some(line => line.inventory > 0 && !saved.firstStockedProducts.includes(line.product)) ||
      boardResult.board.some(item => (item == null ? undefined : item.kind) === 'product' && !saved.firstStockedProducts.includes(item.product))) return null;
  const m = saved.shared.materials;
  const materialSpec = materialSpecification(lines);
  if (!isRecord(m) || !isCount(m.baseUnits) || m.baseUnits > materialSpec.capacityBaseUnits ||
      !isCount(m.refilledBaseUnits) || m.capacityBaseUnits !== materialSpec.capacityBaseUnits ||
      m.refillBaseUnits !== materialSpec.refillBaseUnits ||
      !validSharedDuration('supply', levels.supply, m.duration, 'refillSeconds', stage) ||
      !Number.isFinite(m.elapsed) || m.elapsed < 0 || m.elapsed >= m.duration ||
      (m.baseUnits === m.capacityBaseUnits && m.elapsed !== 0) ||
      (m.elapsed === 0 && m.duration !== sharedSpec('supply', levels.supply, stage).refillSeconds)) return null;
  const shared = { materials: { baseUnits: m.baseUnits, capacityBaseUnits: m.capacityBaseUnits,
    elapsed: m.elapsed, duration: m.duration, refillBaseUnits: m.refillBaseUnits, refilledBaseUnits: m.refilledBaseUnits } };
  for (const name of ['supply', 'packaging']) {
    const service = saved.shared[name];
    if (!isRecord(service) || !Array.isArray(service.queue) ||
        new Set(service.queue).size !== service.queue.length || service.queue.some(id => !lines.some(line => line.id === id)) ||
        !Number.isFinite(service.elapsed) || service.elapsed < 0 ||
        !validSharedDuration(name, levels[name], service.duration, 'serviceSeconds', stage) ||
        service.elapsed >= service.duration ||
        (service.lineId !== null && !lines.some(line => line.id === service.lineId)) ||
        (service.lineId === null && service.duration !== sharedSpec(name, levels[name], stage).serviceSeconds)) return null;
    const waiting = name === 'supply' ? lines.filter(line => line.factory.phase === 'waiting-supply') :
      lines.filter(line => line.buffer.some(batch => batch.status === 'waiting'));
    if (waiting.length !== service.queue.length || waiting.some(line => !service.queue.includes(line.id))) return null;
    if (name === 'supply') {
      const active = lines.filter(line => line.factory.phase === 'supply');
      const activeLine = active[0];
      if (active.length > 1 || service.lineId !== ((activeLine == null ? undefined : activeLine.id) || null) ||
          service.elapsed !== ((activeLine == null ? undefined : activeLine.factory.elapsed) || 0)) return null;
      shared.supply = { level: levels.supply, lineId: service.lineId, elapsed: service.elapsed,
        duration: service.duration, queue: [...service.queue] };
    } else {
      const active = lines.flatMap(line => line.buffer.filter(batch => batch.status === 'packaging'));
      const activeBatch = active[0];
      if (active.length > 1 || service.lineId !== ((activeBatch == null ? undefined : activeBatch.lineId) || null) ||
          (!active.length && (service.batch !== null || service.elapsed !== 0))) return null;
      const batch = active.length ? restoreBatch(service.batch, lines.find(line => line.id === service.lineId)) : null;
      if (active.length && (!batch || JSON.stringify(batch) !== JSON.stringify(batchDescriptor(active[0])))) return null;
      shared.packaging = { level: levels.packaging, lineId: service.lineId, batch, elapsed: service.elapsed,
        duration: service.duration, queue: [...service.queue] };
    }
  }
  const alias = restoreOrder(saved.order, lines, legacyCustomers === true);
  if (!alias) return null;
  const orderFields = ['orders', 'focusedOrderId', 'nextOrderId', 'customerServiceCounts'];
  const hasOrderFields = orderFields.map(field => Object.prototype.hasOwnProperty.call(saved, field));
  let orderBook;
  if (hasOrderFields.every(value => !value)) {
    if (!allowLegacyOrderBook || alias.id !== saved.completedOrders + 1 ||
        !Number.isSafeInteger(alias.id + CONFIG.parallelOrderSlots)) return null;
    orderBook = createOrderBook(alias, lines, saved.completedOrders);
  } else {
    if (!hasOrderFields.every(Boolean) || !Array.isArray(saved.orders) ||
        saved.orders.length !== CONFIG.parallelOrderSlots || !isId(saved.focusedOrderId) ||
        !isId(saved.nextOrderId) || saved.nextOrderId !== saved.completedOrders + CONFIG.parallelOrderSlots + 1 ||
        !legacyCustomers && saved.superOrder !== null) return null;
    const orders = [], ids = new Set();
    for (const previous of saved.orders) {
      const order = restoreOrder(previous, lines, legacyCustomers === true);
      if (!order || order.id >= saved.nextOrderId || ids.has(order.id)) return null;
      ids.add(order.id); orders.push(order);
    }
    const customers = restoreCustomerState(saved, orders, legacyCustomers);
    if (!customers) return null;
    const focused = orders.find(order => order.id === saved.focusedOrderId);
    if (!focused || !sameOrder(alias, focused)) return null;
    orderBook = { orders, superOrder: null, focusedOrderId: focused.id, nextOrderId: saved.nextOrderId, order: focused, ...customers };
  }
  return { schemaVersion: SCHEMA_VERSION, productionAt: saved.productionAt, nextBatchId: saved.nextBatchId,
    firstStockedProducts: PRODUCTS.filter(product => saved.firstStockedProducts.includes(product)),
    pendingProductOrders: [...saved.pendingProductOrders],
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
    this.firstStockedEvents = [];
    this.discardedItem = null;
    for (const line of this.state.lines) this.settleLegacyGroup(line);
    this.dispatchShared();
  }

  getLine(lineId = this.state.selectedLineId) {
    return this.state.lines.find(line => line.id === lineId) || null;
  }

  productStage(product = 'caramel') {
    if (!this.state.lines.some(line => line.product === product)) return 'unbuilt';
    return this.state.firstStockedProducts.includes(product) ? 'stocked' : 'awaiting-stock';
  }

  nextProduct() {
    return PRODUCTS.slice(1).find(product => !this.state.lines.some(line => line.product === product)) || null;
  }

  sharedSpecification(serviceName, level) {
    if (level === undefined) {
      const service = this.state.shared[serviceName];
      level = service == null ? undefined : service.level;
    }
    return sharedSpec(serviceName, level, productionStage(this.state.lines));
  }

  productConstructionOffer(product = 'caramel') {
    if (!PRODUCTS.includes(product)) return null;
    const definition = PRODUCT_DEFINITIONS[product];
    if (!definition || definition.generation === 1) return null;
    const built = this.state.lines.some(line => line.product === product);
    const lineId = `${product}-1`, previousProduct = PRODUCTS[PRODUCTS.indexOf(product) - 1];
    const preferredCell = CONFIG.lines.find(line => line.id === lineId).launcherCell;
    const launcherCell = this.state.board[preferredCell] === null ? preferredCell : this.state.board.findIndex(item => item === null);
    const hasSpace = launcherCell >= 0;
    const affordable = !built && isCount(this.state.coins) && this.state.coins >= definition.constructionCost;
    const numericReady = isCount(this.state.coins) && isId(this.state.nextItemId) &&
      this.state.nextItemId < Number.MAX_SAFE_INTEGER &&
      this.state.board.every(item => !item || (isId(item.id) && item.id < this.state.nextItemId)) &&
      isId(this.state.nextBatchId) && this.state.nextBatchId < Number.MAX_SAFE_INTEGER;
    const reason = built ? 'product-built' : !this.getLine(`${previousProduct}-1`) ? 'previous-product-required' :
      !numericReady ? 'numeric-limit' : !affordable ? 'insufficient-coins' : !hasSpace ? 'board-full' : null;
    return { product, lineId, cost: definition.constructionCost, built, previousProduct,
      stage: this.productStage(product), affordable, hasSpace, boardSpaceAvailable: hasSpace,
      launcherCell, canBuy: reason === null, reason, includesPublicCapacity: true };
  }

  buildProduct(product = 'caramel') {
    const failure = reason => ({ ok: false, action: 'product-build', product, reason });
    const offer = this.productConstructionOffer(product);
    if (!offer) return failure('invalid-product');
    if (!offer.canBuy) return failure(offer.reason);
    const line = { id: offer.lineId, product, outputLevel: 1, capacityLevel: 1,
      inventory: 0, discardedBaseUnits: 0, cacheCapacityBaseUnits: CONFIG.cacheCapacityBaseUnits,
      buffer: [], warehouse: [], legacyGroup: null };
    line.factory = createFactory(line);
    const itemId = this.state.nextItemId;
    const launcher = { kind: 'launcher', lineId: line.id, product, level: 1, id: itemId };
    this.state.coins -= offer.cost;
    this.state.nextItemId++;
    this.state.lines.push(line);
    this.state.lines.sort(configuredLineOrder);
    this.state.board[offer.launcherCell] = launcher;
    this.state.shared.supply.queue.push(line.id);
    this.state.pendingProductOrders.push(product);
    this.state.selectedLineId = line.id;
    this.state.selectedCell = offer.launcherCell;
    // Public construction capacity and paid upgrades are independent. Active
    // operations finish with their old specification; idle ones adopt it now.
    for (const serviceName of ['supply', 'packaging']) {
      const service = this.state.shared[serviceName];
      if (service.lineId === null) service.duration = this.sharedSpecification(serviceName).serviceSeconds;
    }
    if (this.state.shared.materials.elapsed === 0) {
      this.state.shared.materials.duration = this.sharedSpecification('supply').refillSeconds;
    }
    return { ok: true, action: 'product-build', product, lineId: line.id, lineNumber: 1,
      cost: offer.cost, itemId, to: offer.launcherCell, launcherCell: offer.launcherCell };
  }

  selectLine(lineId) {
    const line = this.getLine(lineId);
    if (!line) return { ok: false, reason: 'invalid-line' };
    this.state.selectedLineId = lineId;
    this.state.selectedCell = this.launcherIndex(lineId);
    return { ok: true, action: 'select-line', lineId, product: line.product };
  }

  lineExpansionOffer(target = this.state.selectedLineId) {
    let product = target;
    if (!PRODUCTS.includes(target)) {
      const line = this.getLine(target);
      product = line == null ? undefined : line.product;
    }
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
    const reason = lineCount === 0 ? 'product-not-built' : maxed ? 'line-max' : !numericReady || !definition ? 'numeric-limit' :
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
    line.factory = createFactory(line, 1);
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
        supply.duration = this.sharedSpecification('supply').serviceSeconds;
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
      packaging.duration = this.sharedSpecification('packaging').serviceSeconds;
      this.enqueuePackaging(line);
    }
  }

  finishPhase(line) {
    const f = line.factory, phase = f.phase;
    if (phase === 'supply') {
      this.state.shared.supply.lineId = null;
      this.state.shared.supply.elapsed = 0;
      this.state.shared.supply.duration = this.sharedSpecification('supply').serviceSeconds;
    }
    if (phase === 'transport') { this.cacheFinishedBatch(line); return; }
    f.phase = MAIN_PHASES[MAIN_PHASES.indexOf(phase) + 1];
    f.elapsed = 0;
    f.duration = factoryPhaseSeconds(line.product, f, f.phase);
  }

  credit(line, materialUnits) {
    const unitSize = baseUnits(line.outputLevel);
    const added = Math.floor(materialUnits / unitSize);
    line.inventory += added;
    line.discardedBaseUnits += materialUnits % unitSize;
    if (added > 0 && !this.state.firstStockedProducts.includes(line.product)) {
      this.state.firstStockedProducts.push(line.product);
      this.state.firstStockedProducts.sort((left, right) => PRODUCTS.indexOf(left) - PRODUCTS.indexOf(right));
      this.firstStockedEvents.push(line.product);
    }
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
    service.duration = this.sharedSpecification('packaging').serviceSeconds;
    this.enqueuePackaging(line);
  }

  update(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return { ok: false, reason: 'invalid-time' };
    if (seconds === 0) return { ok: true, produced: 0, producedByLine: [], firstStockedProducts: this.firstStockedEvents.splice(0) };
    const supplySpec = this.sharedSpecification('supply');
    const fastestRefill = Math.min(this.state.shared.materials.duration, supplySpec.refillSeconds);
    const fastestSupply = Math.min(this.state.shared.supply.duration, supplySpec.serviceSeconds);
    const upperMaterial = (Math.ceil(seconds / fastestRefill) + 1) * this.state.shared.materials.refillBaseUnits;
    if (!Number.isSafeInteger(upperMaterial) || this.state.nextBatchId > Number.MAX_SAFE_INTEGER - Math.ceil(seconds / fastestSupply) - 1 ||
        this.state.shared.materials.refilledBaseUnits > Number.MAX_SAFE_INTEGER - upperMaterial ||
        this.state.lines.some(line => {
          const group = line.legacyGroup;
          const pending = (line.factory.batchId === null ? 0 : line.factory.baseUnits) + cacheLoad(line) +
            line.warehouse.reduce((sum, batch) => sum + (batch.credited ? 0 : batch.baseUnits), 0) +
            ((group == null ? undefined : group.completedBaseUnits) || 0);
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
        material.duration = this.sharedSpecification('supply').refillSeconds;
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
    return { ok: true, produced: producedByLine.reduce((sum, line) => sum + line.units, 0), producedByLine,
      firstStockedProducts: this.firstStockedEvents.splice(0) };
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
    const current = this.sharedSpecification(serviceName, level), next = this.sharedSpecification(serviceName, nextLevel);
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
    const service = this.state.shared[serviceName], next = this.sharedSpecification(serviceName, offer.nextLevel);
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
      this.sharedSpecification('supply').serviceSeconds;
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
      processingSeconds: processingSeconds(line.product, level),
      nextProcessingSeconds: processingSeconds(line.product, maxed ? level : level + 1),
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
    const group = line.legacyGroup;
    const f = line.factory, level = line.outputLevel, maxed = level === CONFIG.maxOutputLevel;
    const nextLevel = maxed ? level : level + 1, ratio = baseUnits(nextLevel) / baseUnits(level);
    const requirement = this.state.order.requirements.find(requirement => requirement.product === line.product);
    const target = (requirement == null ? undefined : requirement.level) ||
      Math.min(RULES.maxLevel, level + 4);
    const currentShots = 2 ** Math.max(0, target - level), nextShots = 2 ** Math.max(0, target - nextLevel);
    return { lineId, product: line.product, level, maxed, cost: CONFIG.outputUpgradeCost,
      affordable: !maxed && this.state.coins >= CONFIG.outputUpgradeCost,
      inventoryBefore: line.inventory, inventoryAfter: Math.floor(line.inventory / ratio),
      discardedBaseUnits: (line.inventory % ratio) * baseUnits(level),
      currentBatchLevel: f.outputLevel, currentBatchUnits: f.batchUnits,
      pending: !!line.legacyGroup, nextBatchUnits: batchUnits(nextLevel),
      cycleSeconds: this.machineCycle(line, line.capacityLevel, nextLevel),
      targetLevel: target, currentShots, nextShots, currentMerges: currentShots - 1, nextMerges: nextShots - 1,
      oldBatchCount: ((group == null ? undefined : group.batchIds.length) || 0) +
        ((group == null ? undefined : group.completedBatches.length) || 0) };
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
      completed.reduce((sum, batch) => sum + batch.baseUnits, 0) + ((oldGroup == null ? undefined : oldGroup.completedBaseUnits) || 0);
    if (material > Number.MAX_SAFE_INTEGER - line.discardedBaseUnits) return { ok: false, reason: 'numeric-limit' };
    this.state.coins -= offer.cost; line.inventory = offer.inventoryAfter;
    line.discardedBaseUnits += offer.discardedBaseUnits; line.outputLevel++;
    line.cacheCapacityBaseUnits = cacheCapacityBaseUnits(line.outputLevel);
    Object.assign(this.state.shared.materials, materialSpecification(this.state.lines));
    line.legacyGroup = pending.length || completed.length || oldGroup ? {
      batchIds: [...new Set([...((oldGroup == null ? undefined : oldGroup.batchIds) || []), ...pending.map(batch => batch.id)])],
      completedBaseUnits: ((oldGroup == null ? undefined : oldGroup.completedBaseUnits) || 0) + completed.reduce((sum, batch) => sum + batch.baseUnits, 0),
      completedBatches: [...((oldGroup == null ? undefined : oldGroup.completedBatches) || []), ...completed]
    } : null;
    line.warehouse.forEach(batch => { batch.credited = true; });
    this.refreshWaiting(line); this.state.board[from].level = line.outputLevel;
    this.settleLegacyGroup(line);
    if (line.factory.phase === 'waiting-cache' &&
        cacheLoad(line) + line.factory.baseUnits <= line.cacheCapacityBaseUnits) {
      this.cacheFinishedBatch(line);
    }
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
    if (!['board', 'factory', 'customers'].includes(page)) return { ok: false, reason: 'invalid-page' };
    this.state.page = page; return { ok: true };
  }

  boardOrderProgress(orderOrId = this.state.focusedOrderId) {
    return BOARD_RULES.orderProgress(this.state, orderOrId);
  }

  previewDelivery(orderId = this.state.focusedOrderId) {
    return BOARD_RULES.previewDelivery(this.state, orderId);
  }

  previewDrop(from, to) {
    return BOARD_RULES.previewDrop(this.state, from, to);
  }

  previewDiscard(index) {
    return BOARD_RULES.previewDiscard(this.state, index);
  }

  preparationPlan(product, level, quantity = 1, orderId = null) {
    return BOARD_RULES.preparationPlan(this.state, product, level, quantity, orderId);
  }

  boardSources(product, targetLevel) {
    return BOARD_RULES.boardSources(this.state, product, targetLevel);
  }

  restoreDiscard() {
    const failure = reason => ({ ok: false, action: 'restore-discard', reason });
    const discarded = this.discardedItem;
    const discardedProduct = discarded == null ? undefined : discarded.item;
    if ((discardedProduct == null ? undefined : discardedProduct.kind) !== 'product') return failure('nothing-to-restore');
    const item = { ...discarded.item };
    const to = isCell(discarded.from) && this.state.board[discarded.from] === null
      ? discarded.from : this.state.board.findIndex(cell => cell === null);
    if (to < 0) return { ...failure('board-full'), from: discarded.from,
      product: item.product, level: item.level, itemId: item.id };
    const readyBefore = new Set(this.state.orders.filter(order => this.boardOrderProgress(order).ready).map(order => order.id));
    this.state.board[to] = item;
    this.state.selectedCell = to;
    this.discardedItem = null;
    return { ok: true, action: 'restore-discard', from: discarded.from, to,
      product: item.product, level: item.level, itemId: item.id,
      madeOrder: this.state.orders.some(order => !readyBefore.has(order.id) && this.boardOrderProgress(order).ready) };
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
    this.discardedItem = { item: { ...item }, from: index };
    this.state.board[index] = null;
    return { ok: true, action: 'discard', from: index, product: item.product, level: item.level, itemId: item.id };
  }

  getOrders() {
    return [...this.state.orders];
  }

  getOrder(orderId = this.state.focusedOrderId) {
    return this.getOrders().find(order => order.id === orderId) || null;
  }

  focusOrder(orderId) {
    const order = this.getOrder(orderId);
    if (!order) return { ok: false, action: 'order-focus', reason: 'order-not-found', orderId };
    this.state.focusedOrderId = order.id;
    this.state.order = order;
    return { ok: true, action: 'order-focus', orderId: order.id, slot: this.getOrders().indexOf(order) };
  }

  cycleOrder(offset) {
    if (!Number.isSafeInteger(offset)) return { ok: false, action: 'order-focus', reason: 'invalid-offset' };
    const orders = this.getOrders();
    const index = orders.findIndex(order => order.id === this.state.focusedOrderId);
    const next = index + offset;
    if (next < 0 || next >= orders.length) return { ok: false, action: 'order-focus', reason: 'order-edge' };
    return this.focusOrder(orders[next].id);
  }

  trackSuperOrder(customerId) {
    return { ok: false, action: 'super-order-track', reason: getCustomer(customerId) || customerId === null ?
      'super-orders-unconfigured' : 'invalid-customer', customerId };
  }

  customerServiceCount(customerId = CONFIG.currentCustomerId) {
    const count = this.state.customerServiceCounts[customerId];
    return isCount(count) ? count : 0;
  }

  customerInfo(customerId) {
    const customer = getCustomer(customerId);
    if (!customer) return null;
    const services = this.customerServiceCount(customerId);
    const superOrdersCompleted = this.state.customerSuperOrderCounts[customerId];
    const lastRead = this.state.customerReadSuperOrders[customerId];
    const unreadNode = [...thresholds, 12, 14].filter(threshold => threshold > lastRead && threshold <= superOrdersCompleted)
      .sort((left, right) => right - left)[0];
    const unreadCollection = services > 0 && !this.state.customerCollectedRead[customerId];
    const progress = getProgress(superOrdersCompleted, CUSTOMER_BASE_REWARD);
    if (!progress.stars) progress.label = services ? '已结识·零星' : '新面孔·未收录';
    progress.nextGiftPaid = progress.nextStar !== null && Object.prototype.hasOwnProperty.call(this.state.customerPaidGifts[customerId], progress.nextStar);
    if (progress.nextGiftPaid) progress.nextGift = 0;
    return { customer, eligible: customerEligible(customer, this.state.firstStockedProducts),
      collected: services > 0, services, superOrdersCompleted, progress,
      superOrder: null, superOrderAvailability: 'unconfigured',
      nextSuperOrder: null, trackingSuperOrder: false,
      visiting: this.state.orders.some(order => order.customerId === customerId),
      unread: Boolean(unreadNode || unreadCollection),
      unreadKind: unreadNode ? [12, 14].includes(unreadNode) ? 'daily' : 'growth' : unreadCollection ? 'collected' : null,
      paidGifts: { ...this.state.customerPaidGifts[customerId] } };
  }

  customerCollection() {
    return CUSTOMERS.map(customer => this.customerInfo(customer.id));
  }

  markCustomerRead(customerId) {
    const info = this.customerInfo(customerId);
    if (!info) return { ok: false, action: 'customer-read', reason: 'invalid-customer', customerId };
    this.state.customerReadSuperOrders[customerId] = info.superOrdersCompleted;
    this.state.customerCollectedRead[customerId] = info.collected;
    return { ok: true, action: 'customer-read', customerId };
  }

  orderProgress(orderId = this.state.focusedOrderId) {
    const order = this.getOrder(orderId);
    if (!order) return null;
    const allocation = this.boardOrderProgress(order);
    const requirements = allocation.requirements.map(requirement => {
      const ready = requirement.ready;
      const requiredBaseUnits = baseUnits(requirement.level);
      let availableBaseUnits = ready ? requiredBaseUnits : 0;
      if (!ready) {
        for (const item of this.state.board) {
          if (item && item.kind === 'product' && item.product === requirement.product) {
            availableBaseUnits = Math.min(requiredBaseUnits, availableBaseUnits + baseUnits(item.level));
          }
          if (availableBaseUnits === requiredBaseUnits) break;
        }
        for (const line of this.state.lines) {
          if (line.product !== requirement.product) continue;
          const unitSize = baseUnits(line.outputLevel);
          const neededUnits = Math.ceil((requiredBaseUnits - availableBaseUnits) / unitSize);
          // Clamp the count before multiplication, since a long-running line
          // may have far more inventory than this one order can consume.
          const contribution = Math.min(line.inventory, neededUnits) * unitSize;
          availableBaseUnits = Math.min(requiredBaseUnits, availableBaseUnits + contribution);
        }
      }
      return { ...requirement, ready, boardUnits: ready ? 1 : 0,
        requiredBaseUnits, availableBaseUnits, missingBaseUnits: requiredBaseUnits - availableBaseUnits };
    });
    const ready = requirements.every(requirement => requirement.ready);
    return { orderId: order.id, ready,
      status: ready ? 'ready' : requirements.every(requirement => requirement.missingBaseUnits === 0) ? 'materials-ready' : 'missing-materials',
      requirements };
  }

  orderReady(orderId = this.state.focusedOrderId) {
    const progress = this.boardOrderProgress(orderId);
    return Boolean(progress == null ? undefined : progress.ready);
  }

  deliver(orderId = this.state.focusedOrderId) {
    const order = this.getOrder(orderId);
    if (!order) return { ok: false, action: 'deliver', reason: 'order-not-found', orderId };
    if (!restoreOrder(order, this.state.lines)) {
      return { ok: false, action: 'deliver', reason: 'invalid-order', orderId };
    }
    const customerId = order.customerId;
    const completed = this.state.customerSuperOrderCounts[customerId];
    const delivery = this.previewDelivery(orderId);
    if (!delivery.ok) return { ok: false, action: 'deliver', reason: delivery.reason, orderId };
    const consumed = delivery.items.map(item => ({ index: item.index, product: item.product, level: item.level }));
    const serviceCount = this.customerServiceCount(customerId);
    const progress = getProgress(completed, CUSTOMER_BASE_REWARD);
    const starReward = 0;
    const totalReward = order.reward;
    if (!isCount(this.state.coins) || !isCount(this.state.completedOrders) ||
        !restoreCustomerState(this.state, this.state.orders, false) ||
        !isCount(this.state.customerServiceCounts[customerId]) ||
        !Number.isSafeInteger(totalReward) || !Number.isSafeInteger(this.state.coins + totalReward) || !isId(this.state.nextOrderId) ||
        this.state.nextOrderId !== this.state.completedOrders + CONFIG.parallelOrderSlots + 1 ||
        this.state.orders.some(candidate => candidate.id >= this.state.nextOrderId) ||
        !Number.isSafeInteger(this.state.nextOrderId + 1) || !Number.isSafeInteger(this.state.completedOrders + 1) ||
        !Number.isSafeInteger(serviceCount + 1) || !Number.isSafeInteger(this.state.customerRefillCount + 1)) {
      return { ok: false, action: 'deliver', reason: 'numeric-limit', orderId };
    }
    const slot = this.getOrders().indexOf(order);
    const counts = { ...this.state.customerServiceCounts, [customerId]: serviceCount + 1 };
    const next = nextCustomerOrder(this.state,
      this.state.orders.filter(candidate => candidate.id !== order.id), counts);
    if (!next) return { ok: false, action: 'deliver', reason: 'no-valid-customer-order', orderId };
    for (const item of consumed) this.state.board[item.index] = null;
    this.state.coins += totalReward; this.state.completedOrders++;
    this.state.customerServiceCounts[customerId] = serviceCount + 1;
    const replacement = next.order;
    this.state.customerRefillCount++;
    this.state.customerWaitingQueue = next.queues.regular.filter(id => id !== replacement.customerId);
    this.state.customerMaxQueue = next.queues.max.filter(id => id !== replacement.customerId);
    if (getProgress(this.state.customerSuperOrderCounts[replacement.customerId]).stars === 5) this.state.customerMaxQueue.push(replacement.customerId);
    this.state.customerLastVisit[replacement.customerId] = replacement.id;
    this.state.nextOrderId++;
    if (replacement.requirements.some(requirement => requirement.product === this.state.pendingProductOrders[0])) this.state.pendingProductOrders.shift();
    this.state.orders[slot] = replacement;
    if (this.state.focusedOrderId === order.id) this.state.focusedOrderId = replacement.id;
    this.state.order = this.getOrder();
    if (consumed.some(item => item.index === this.state.selectedCell)) this.state.selectedCell = this.launcherIndex();
    return { ok: true, action: 'deliver', from: consumed[0].index, level: consumed[0].level,
      consumed, reward: order.reward, starReward, totalReward, previousStars: progress.stars, stars: progress.stars,
      orderId: order.id, slot, newOrderId: replacement.id,
      orderLabel: delivery.orderLabel, deliveredItems: delivery.items,
      effects: delivery.effects, hasNewMissing: delivery.hasNewMissing,
      orderKind: order.kind, customerId, customerServiceCount: serviceCount + 1,
      firstCollection: serviceCount === 0, collectedNew: serviceCount === 0, starAdvanced: false, superOrdersCompleted: completed };
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

