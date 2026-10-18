export const PRODUCTS = [
  { id: 'original', name: '原味', index: 0 },
  { id: 'caramel', name: '焦糖', index: 1 },
];

export const PRODUCT_MAX_LEVEL = 5;

export const SCENARIOS = [
  { id: 'chain', title: '连续合成', hint: '从选中的原味一级开始，依次拖到右侧同级商品，每次松手合成后再拿起，直到原味四级。' },
  { id: 'sources', title: '合成链与来源', hint: '查看原味三级的合成链，对比原味一级与二级发射器；定位来源后取货，合成订单所需的商品。' },
  { id: 'orders', title: '多单齐货', hint: '多单共用高阶现货；合成原味三级后对比实际消耗，查看交付对其他订单的影响。' },
  { id: 'protected', title: '订单保护', hint: '订单需要原味二级与三级各一份；两份原味三级合成后虽可代交，但只剩一件，会触发份数保护。' },
  { id: 'surplus', title: '有余量可合', hint: '三份原味三级中合掉两份，仍有三级与四级各一件，可分别交付原味二级、三级需求，无须确认。' },
  { id: 'launchers', title: '发射器状态', hint: '原味一级有货可取，焦糖二级正在补货；选中发射器查看库存和生产进度。' },
  { id: 'full', title: '满盘与边界', hint: '满盘不能发射，但仍能合成腾位；五级商品不能再合成，发射器可移到空格。' },
];

const COLUMNS = 7;
const BOARD_SIZE = 63;
const MAX_LEVEL = PRODUCT_MAX_LEVEL;
const PRODUCTION_CYCLE_SECONDS = 6;
const LAUNCHER_CAPACITY = { original: 12, caramel: 8 };
const validCell = index => Number.isInteger(index) && index >= 0 && index < BOARD_SIZE;
const matches = (item, requirement) => item?.kind === 'product'
  && item.product === requirement.product && item.level === requirement.level;
const qualifies = (item, requirement) => item?.kind === 'product'
  && item.product === requirement.product && item.level >= requirement.level;

export function getProductChain(product) {
  const definition = PRODUCTS.find(entry => entry.id === product);
  if (!definition) return [];
  const levelNames = ['一', '二', '三', '四', '五'];
  return Array.from({ length: PRODUCT_MAX_LEVEL }, (_, index) => ({
    product, level: index + 1, name: `${definition.name}${levelNames[index]}级`,
  }));
}

export function createScenario(id = 'chain') {
  const scenario = SCENARIOS.some(entry => entry.id === id) ? id : 'chain';
  const state = {
    board: Array(BOARD_SIZE).fill(null),
    orders: [], selected: 16, focusedOrder: 0, nextId: 1, merges: 0,
    discardedItem: null,
  };
  const put = (index, product, level, kind = 'product', stock) => {
    state.board[index] = { id: state.nextId++, kind, product, level };
    if (kind === 'launcher') {
      Object.assign(state.board[index], {
        stock,
        lineNumber: state.board.filter(item => item?.kind === 'launcher' && item.product === product).length,
        capacity: LAUNCHER_CAPACITY[product],
        productionSeconds: 0,
        productionCycleSeconds: PRODUCTION_CYCLE_SECONDS,
      });
    }
  };
  const order = (id, label, requirements) => ({ id, label, requirements });
  const need = (product, level) => ({ product, level });

  if (scenario === 'full') {
    for (let index = 0; index < BOARD_SIZE; index++) {
      put(index, index % 3 === 0 ? 'caramel' : 'original', index % MAX_LEVEL + 1);
    }
    put(16, 'original', 2); put(17, 'original', 2);
    put(23, 'original', 5); put(24, 'original', 5);
    put(47, 'original', 4); put(48, 'caramel', 3);
    state.orders = [order('order-a', '午后点心', [need('original', 4), need('caramel', 3)])];
  } else if (scenario === 'launchers') {
    put(16, 'original', 1); put(17, 'original', 1);
    put(25, 'caramel', 2); put(26, 'caramel', 2);
    state.selected = 8;
    state.orders = [order('order-a', '双味分享', [need('original', 3), need('caramel', 3)])];
  } else if (scenario === 'sources') {
    put(16, 'original', 2); put(17, 'original', 2);
    put(25, 'caramel', 2); put(26, 'caramel', 2);
    put(31, 'original', 1); put(32, 'original', 1);
    state.selected = 16;
    state.orders = [order('order-a', '双味分享', [need('original', 3), need('caramel', 3)])];
  } else if (scenario === 'orders') {
    put(16, 'original', 2); put(17, 'original', 2);
    put(25, 'caramel', 4); put(31, 'caramel', 2);
    put(34, 'original', 4);
    state.selected = 16;
    state.orders = [
      order('order-a', '午后聚会', [need('original', 4), need('caramel', 3)]),
      order('order-b', '双味小单', [need('original', 3), need('caramel', 3)]),
      order('order-c', '原味小单', [need('original', 2)]),
      order('order-d', '焦糖加单', [need('caramel', 5)]),
    ];
  } else if (scenario === 'chain') {
    put(16, 'original', 1); put(17, 'original', 1);
    put(18, 'original', 2); put(19, 'original', 3);
    put(25, 'caramel', 2); put(26, 'caramel', 2);
    put(30, 'caramel', 3); put(34, 'original', 2); put(41, 'original', 5);
    state.orders = [order('order-a', '午后点心', [need('original', 4), need('caramel', 3)])];
  } else {
    put(16, 'original', 3); put(17, 'original', 3);
    if (scenario === 'surplus') put(18, 'original', 3);
    put(23, 'original', 1); put(24, 'original', 1);
    put(31, 'caramel', 3); put(40, 'caramel', 2); put(41, 'original', 1);
    state.orders = [
      order('order-a', '双味分享', [need('original', 2), need('original', 3), need('caramel', 4)]),
      order('order-b', '焦糖小单', [need('caramel', 3)]),
    ];
  }

  put(8, 'original', 1, 'launcher', 12);
  put(12, 'caramel', ['launchers', 'sources', 'orders'].includes(scenario) ? 2 : 1,
    'launcher', scenario === 'launchers' ? 0 : 8);
  if (scenario === 'sources') put(15, 'original', 2, 'launcher', 6);
  if (scenario === 'launchers') state.board[12].productionSeconds = PRODUCTION_CYCLE_SECONDS / 2;
  return state;
}

export function orderMatch(state, item) {
  if (item?.kind !== 'product') return [];
  return state.orders.filter(order => order.requirements.some(requirement => qualifies(item, requirement)))
    .map(order => order.id);
}

export function count(state, product, level) {
  return state.board.filter(item => matches(item, { product, level })).length;
}

export function orderProgress(state, orderOrId) {
  const order = typeof orderOrId === 'object' ? orderOrId
    : state.orders.find(entry => entry.id === orderOrId);
  if (!order) return null;
  const requirements = order.requirements.map((requirement, requirementIndex) => ({
    ...requirement, requirementIndex, ready: false, cell: -1,
    itemId: null, actualLevel: null, substituted: false,
  }));
  const available = state.board.flatMap((item, index) => item?.kind === 'product' ? [{ item, index }] : [])
    .sort((left, right) => left.item.level - right.item.level || left.index - right.index);
  const used = new Set();
  for (const requirement of [...requirements].sort((left, right) =>
    right.level - left.level || left.requirementIndex - right.requirementIndex)) {
    const selected = available.find(({ item, index }) => !used.has(index) && qualifies(item, requirement));
    if (!selected) continue;
    used.add(selected.index);
    Object.assign(requirement, { ready: true, cell: selected.index, itemId: selected.item.id,
      actualLevel: selected.item.level, substituted: selected.item.level > requirement.level });
  }
  const missing = [];
  for (const requirement of requirements.filter(entry => !entry.ready)) {
    const existing = missing.find(entry => entry.product === requirement.product && entry.level === requirement.level);
    if (existing) existing.quantity++;
    else missing.push({ product: requirement.product, level: requirement.level, quantity: 1 });
  }
  return { orderId: order.id, orderLabel: order.label, ready: used.size === requirements.length,
    matchedCount: used.size, missingCount: requirements.length - used.size,
    requirements, missing, cells: requirements.filter(entry => entry.ready).map(entry => entry.cell),
    substitutionCount: requirements.filter(entry => entry.substituted).length };
}

function requiredCells(state, order) {
  const progress = orderProgress(state, order);
  return progress?.ready ? progress.cells : null;
}

export function ready(state, order) {
  return Boolean(orderProgress(state, order)?.ready);
}

function missingIncrease(before, after) {
  return after.missing.flatMap(entry => {
    const previous = before.missing.find(other => other.product === entry.product && other.level === entry.level);
    const quantity = entry.quantity - (previous?.quantity ?? 0);
    return quantity > 0 ? [{ product: entry.product, level: entry.level, quantity }] : [];
  });
}

function affectedOrders(state, board) {
  const after = { ...state, board };
  return state.orders.filter(order => missingIncrease(orderProgress(state, order), orderProgress(after, order)).length)
    .map(order => order.id);
}

export function previewDrop(state, from, to) {
  const result = { kind: 'invalid', from, to };
  if (!validCell(from) || !validCell(to)) return { ...result, reason: 'invalid-cell' };
  const source = state.board[from];
  const target = state.board[to];
  if (!source) return { ...result, reason: 'empty-cell' };
  Object.assign(result, { sourceId: source.id, product: source.product, level: source.level });
  if (target) result.targetId = target.id;
  if (from === to) return { ...result, kind: 'same' };
  if (!target) return { ...result, kind: 'move' };
  if (source.kind !== 'product' || target.kind !== 'product'
    || source.product !== target.product || source.level !== target.level) {
    return { ...result, reason: 'incompatible' };
  }
  if (source.level >= MAX_LEVEL) return { ...result, reason: 'max-level' };
  const afterBoard = [...state.board];
  afterBoard[from] = null;
  afterBoard[to] = { ...source, level: source.level + 1 };
  const orderIds = affectedOrders(state, afterBoard);
  if (orderIds.length) {
    return { ...result, kind: 'protected', reason: 'order-needed', orderIds };
  }
  return { ...result, kind: 'merge', orderIds: [] };
}

export function drop(state, from, to, confirmed = false) {
  const preview = previewDrop(state, from, to);
  if (preview.kind === 'invalid' || (preview.kind === 'protected' && !confirmed)) {
    return { ...preview, ok: false, madeOrder: false };
  }
  const source = state.board[from];
  if (preview.kind === 'same') {
    state.selected = to;
    return { ...preview, ok: true, madeOrder: false };
  }
  if (preview.kind === 'move') {
    state.board[to] = source;
    state.board[from] = null;
    state.selected = to;
    return { ...preview, ok: true, itemId: source.id, madeOrder: false };
  }
  const item = { id: state.nextId++, kind: 'product', product: source.product, level: source.level + 1 };
  const readyBefore = new Set(state.orders.filter(order => ready(state, order)).map(order => order.id));
  state.board[to] = item;
  state.board[from] = null;
  state.selected = to;
  state.merges++;
  const madeOrder = state.orders.some(order => !readyBefore.has(order.id) && ready(state, order));
  return { ...preview, kind: 'merge', reason: undefined, ok: true, level: item.level, itemId: item.id, madeOrder };
}

export function discard(state, index, confirmed = false) {
  const result = { kind: 'invalid', from: index, ok: false };
  if (!validCell(index)) return { ...result, reason: 'invalid-cell' };
  const item = state.board[index];
  if (!item) return { ...result, reason: 'empty-cell' };
  Object.assign(result, { sourceId: item.id, product: item.product, level: item.level });
  if (item.kind === 'launcher') return { ...result, reason: 'launcher-protected' };
  const afterBoard = [...state.board];
  afterBoard[index] = null;
  const orderIds = affectedOrders(state, afterBoard);
  if (orderIds.length && !confirmed) {
    return { ...result, kind: 'protected', reason: 'order-needed', orderIds };
  }
  state.discardedItem = { item: { ...item }, from: index };
  state.board[index] = null;
  if (state.selected === index) state.selected = -1;
  return { ...result, kind: 'discard', ok: true, orderIds };
}

export function restoreDiscard(state) {
  const result = { kind: 'restore-discard', ok: false };
  const discarded = state.discardedItem;
  if (discarded?.item?.kind !== 'product') return { ...result, reason: 'nothing-to-restore' };
  const item = { ...discarded.item };
  Object.assign(result, { from: discarded.from, itemId: item.id, product: item.product, level: item.level });
  const to = validCell(discarded.from) && !state.board[discarded.from]
    ? discarded.from : state.board.findIndex(cell => !cell);
  if (to < 0) return { ...result, reason: 'board-full' };
  const readyBefore = new Set(state.orders.filter(order => ready(state, order)).map(order => order.id));
  state.board[to] = item;
  state.discardedItem = null;
  state.selected = to;
  const madeOrder = state.orders.some(order => !readyBefore.has(order.id) && ready(state, order));
  return { ...result, ok: true, to, madeOrder };
}

export function nextLaunchCell(state, index) {
  if (!validCell(index) || state.board[index]?.kind !== 'launcher') return -1;
  const row = Math.floor(index / COLUMNS), column = index % COLUMNS;
  const candidates = [];
  state.board.forEach((item, target) => {
    if (item) return;
    const dx = target % COLUMNS - column, dy = Math.floor(target / COLUMNS) - row;
    candidates.push({ index: target, distance: dx * dx + dy * dy,
      angle: (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2) });
  });
  if (!candidates.length) return -1;
  candidates.sort((left, right) => left.distance - right.distance || left.angle - right.angle);
  return candidates[0].index;
}

export function launcherStatus(state, index) {
  if (!validCell(index)) return null;
  const launcher = state.board[index];
  if (launcher?.kind !== 'launcher') return null;
  const nextCell = nextLaunchCell(state, index);
  const cycle = launcher.productionCycleSeconds;
  const fullStock = launcher.stock >= launcher.capacity;
  const elapsed = Math.max(0, Math.min(launcher.productionSeconds, cycle));
  return {
    kind: launcher.stock < 1 ? 'producing' : nextCell < 0 ? 'board-full' : 'ready',
    stock: launcher.stock,
    outputLevel: launcher.level,
    product: launcher.product,
    progress: fullStock ? 0 : elapsed / cycle,
    remainingSeconds: fullStock ? 0 : Math.max(0, cycle - elapsed),
    nextCell,
  };
}

export function getSources(state, product, targetLevel) {
  return state.board.flatMap((item, index) => {
    if (item?.kind !== 'launcher' || item.product !== product) return [];
    const canSupply = Number.isInteger(targetLevel)
      && targetLevel >= 1 && targetLevel <= PRODUCT_MAX_LEVEL;
    return [{
      index, itemId: item.id, product: item.product, level: item.level,
      stock: item.stock, lineNumber: item.lineNumber,
      status: launcherStatus(state, index), canSupply,
      mergesNeeded: canSupply ? Math.max(0, 2 ** (targetLevel - item.level) - 1) : null,
    }];
  }).sort((left, right) => left.lineNumber - right.lineNumber);
}

export function getPreparationPlan(state, product, targetLevel, quantity = 1, orderId = null) {
  const context = orderId == null ? null : orderProgress(state, orderId);
  const contextRequirements = context?.requirements.filter(entry => entry.product === product && entry.level === targetLevel) ?? [];
  const requested = contextRequirements.length || (Number.isInteger(quantity) && quantity > 0 ? quantity : 1);
  const valid = PRODUCTS.some(entry => entry.id === product)
    && Number.isInteger(targetLevel) && targetLevel >= 1 && targetLevel <= MAX_LEVEL;
  const contextCells = new Set(contextRequirements.filter(entry => entry.ready).map(entry => entry.cell));
  const qualifiedItems = valid ? state.board.flatMap((item, index) => {
    if (!qualifies(item, { product, level: targetLevel })
      || (contextRequirements.length && !contextCells.has(index))) return [];
    return [{ index, id: item.id, product: item.product, level: item.level }];
  }).sort((left, right) => left.level - right.level || left.index - right.index) : [];
  const owned = qualifiedItems.length;
  const missing = Math.max(0, requested - owned);
  const cellsByLevel = Array.from({ length: MAX_LEVEL + 1 }, () => []);
  const reservedByLevel = [];
  const reserveByLevel = Array(MAX_LEVEL + 1).fill(0);
  const availableByLevel = Array(MAX_LEVEL + 1).fill(0);

  if (valid) {
    state.board.forEach((item, index) => {
      if (item?.kind === 'product' && item.product === product && item.level < targetLevel) {
        cellsByLevel[item.level].push(index);
      }
    });
    for (let level = 1; level < targetLevel; level++) {
      // Keep the existing goods needed by an order out of the suggested route.
      // This is guidance only; previewDrop remains the authority for every merge.
      const needed = Math.max(0, ...state.orders.map(order => orderProgress(state, order).requirements
        .filter(requirement => requirement.product === product
          && (requirement.ready ? requirement.actualLevel === level : requirement.level === level)).length));
      reserveByLevel[level] = needed;
      const reserved = Math.min(cellsByLevel[level].length, needed);
      if (reserved) reservedByLevel.push({ level, count: reserved });
      availableByLevel[level] = cellsByLevel[level].length - reserved;
    }
  }

  const canMake = (sourceLevel, draws) => {
    let carried = 0;
    for (let level = 1; level <= targetLevel; level++) {
      const amount = cellsByLevel[level].length + carried + (level === sourceLevel ? draws : 0);
      if (level === targetLevel) return amount >= missing;
      carried = Math.floor(Math.max(0, amount - reserveByLevel[level]) / 2);
    }
    return false;
  };
  const workNeeded = (sourceLevel, draws) => {
    let mergesNeeded = 0;
    let boardItemsUsed = 0;
    const boardUsedByLevel = Array(MAX_LEVEL + 1).fill(0);
    const mergesByLevel = Array(MAX_LEVEL + 1).fill(0);
    const safetyReserveByLevel = [];
    const fulfill = (level, amount) => {
      if (!amount) return true;
      const existing = Math.min(availableByLevel[level], amount);
      boardUsedByLevel[level] = existing;
      boardItemsUsed += existing;
      let shortage = amount - existing;
      if (!shortage) return true;
      const futureReserve = Math.max(0, reserveByLevel[level] - cellsByLevel[level].length);
      if (futureReserve) safetyReserveByLevel.push({ level, count: futureReserve });
      shortage += futureReserve;
      if (level === sourceLevel) shortage = Math.max(0, shortage - draws);
      if (!shortage) return true;
      if (level <= 1) return false;
      mergesNeeded += shortage;
      mergesByLevel[level] = shortage;
      return fulfill(level - 1, shortage * 2);
    };
    return fulfill(targetLevel, missing)
      ? { mergesNeeded, boardItemsUsed, boardUsedByLevel, mergesByLevel, safetyReserveByLevel,
        futureReserveCount: safetyReserveByLevel.reduce((total, entry) => total + entry.count, 0) } : null;
  };

  const canCompleteFromBoard = valid && canMake(null, 0);
  const boardWork = canCompleteFromBoard ? workNeeded(null, 0) : null;
  const mergeCandidates = [];
  const protectedMerges = [];
  if (valid && missing) {
    for (let level = targetLevel - 1; level >= 1; level--) {
      const cells = cellsByLevel[level];
      const reserved = cells.length - availableByLevel[level];
      for (let left = 0; left < cells.length; left++) {
        for (let right = left + 1; right < cells.length; right++) {
          const from = cells[left], to = cells[right];
          const preview = previewDrop(state, from, to);
          const pair = { from, to, product, level, resultLevel: level + 1 };
          if (preview.kind === 'protected') protectedMerges.push(pair);
          else if (preview.kind === 'merge' && left >= reserved) mergeCandidates.push(pair);
        }
      }
    }
  }

  const sourceWork = [];
  const sources = getSources(state, product, targetLevel).map(source => {
    if (!valid || !source.canSupply) {
      return { ...source, cantSupply: true, drawsNeeded: null, mergesNeeded: null,
        boardItemsUsed: 0, canCompleteFromBoard, safetyReserveByLevel: [], futureReserveCount: 0 };
    }
    let lower = 0;
    const sourceLevel = Math.min(source.level, targetLevel);
    const priorityDraws = source.level > targetLevel ? context?.requirements.filter(requirement =>
      requirement.product === product && !requirement.ready
      && requirement.level > targetLevel && requirement.level <= source.level).length ?? 0 : 0;
    const canSupplyGoal = draws => canMake(sourceLevel, Math.max(0, draws - priorityDraws));
    let upper = missing * 2 ** (targetLevel - sourceLevel) + priorityDraws;
    while (!canSupplyGoal(upper)) upper *= 2;
    while (lower < upper) {
      const midpoint = Math.floor((lower + upper) / 2);
      if (canSupplyGoal(midpoint)) upper = midpoint;
      else lower = midpoint + 1;
    }
    const work = workNeeded(sourceLevel, Math.max(0, lower - priorityDraws));
    sourceWork.push(work);
    return { ...source, cantSupply: false, drawsNeeded: lower,
      mergesNeeded: work.mergesNeeded, boardItemsUsed: work.boardItemsUsed, canCompleteFromBoard,
      priorityDrawsNeeded: lower ? priorityDraws : 0,
      safetyReserveByLevel: work.safetyReserveByLevel, futureReserveCount: work.futureReserveCount };
  });
  const guidanceWork = boardWork ? [boardWork] : sourceWork;
  const availableMerges = mergeCandidates.filter(pair => guidanceWork.some(work =>
    work.boardUsedByLevel[pair.level] >= 2 && work.mergesByLevel[pair.resultLevel] > 0));
  const reservedCount = reservedByLevel.reduce((total, entry) => total + entry.count, 0);
  return {
    valid, product, level: targetLevel, quantity: requested, owned, missing,
    ownedCells: qualifiedItems.map(item => item.index), qualifiedItems,
    complete: valid && !missing,
    canCompleteFromBoard,
    boardMergesNeeded: boardWork?.mergesNeeded ?? null,
    boardItemsUsed: boardWork?.boardItemsUsed ?? 0,
    safetyReserveByLevel: boardWork?.safetyReserveByLevel ?? [],
    futureReserveCount: boardWork?.futureReserveCount ?? 0,
    reservedCount, hasReservedMaterials: reservedCount > 0, reservedByLevel,
    availableMerges, protectedMerges, nextMerge: availableMerges[0] ?? null, sources,
  };
}

export function advanceProduction(state, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  const replenished = [];
  state.board.forEach((launcher, index) => {
    if (launcher?.kind !== 'launcher') return;
    if (launcher.stock >= launcher.capacity) {
      launcher.productionSeconds = 0;
      return;
    }
    const cycle = launcher.productionCycleSeconds;
    const elapsed = launcher.productionSeconds + seconds;
    const produced = Math.min(launcher.capacity - launcher.stock, Math.floor((elapsed + 1e-9) / cycle));
    if (produced > 0) {
      launcher.stock += produced;
      replenished.push(index);
    }
    launcher.productionSeconds = launcher.stock >= launcher.capacity
      ? 0 : Math.max(0, elapsed - produced * cycle);
  });
  return replenished;
}

export function launch(state, index) {
  const result = { kind: 'launch', from: index, ok: false };
  if (!validCell(index)) return { ...result, reason: 'invalid-cell' };
  const launcher = state.board[index];
  if (launcher?.kind !== 'launcher') return { ...result, reason: 'missing-launcher' };
  if (launcher.stock < 1) return { ...result, reason: 'empty-stock' };
  const to = nextLaunchCell(state, index);
  if (to < 0) return { ...result, reason: 'board-full' };
  const item = { id: state.nextId++, kind: 'product', product: launcher.product, level: launcher.level };
  state.board[to] = item;
  launcher.stock--;
  state.selected = index;
  return { ...result, ok: true, to, sourceId: launcher.id, itemId: item.id, product: item.product, level: item.level };
}

export function previewDelivery(state, orderId) {
  const result = {
    ok: false, kind: 'delivery-preview', orderId, orderLabel: '',
    cells: [], items: [], effects: [], hasNewMissing: false, hasSharedItems: false,
  };
  const order = state.orders.find(entry => entry.id === orderId);
  if (!order) return { ...result, reason: 'order-not-found' };
  result.orderLabel = order.label;
  const cells = requiredCells(state, order);
  if (!cells) return { ...result, reason: 'order-not-ready' };
  const progress = orderProgress(state, order);
  const items = cells.map(index => {
    const { id, kind, product, level } = state.board[index];
    const requirement = progress.requirements.find(entry => entry.cell === index);
    return { index, id, kind, product, level, requiredLevel: requirement.level,
      requirementIndex: requirement.requirementIndex, substituted: level > requirement.level };
  });
  const consumed = new Set(cells);
  const after = { ...state, board: state.board.map((item, index) => consumed.has(index) ? null : item) };
  const effects = state.orders.filter(entry => entry.id !== orderId).map(other => {
    const beforeProgress = orderProgress(state, other), afterProgress = orderProgress(after, other);
    const missingBefore = beforeProgress.missing, missingAfter = afterProgress.missing;
    const newMissing = missingIncrease(beforeProgress, afterProgress), sharedItems = [];
    for (const item of items.filter(item => other.requirements.some(requirement => qualifies(item, requirement)))) {
      const existing = sharedItems.find(entry => entry.product === item.product && entry.level === item.level);
      if (existing) existing.quantity++;
      else sharedItems.push({ product: item.product, level: item.level, quantity: 1 });
    }
    const readyBefore = beforeProgress.ready, readyAfter = afterProgress.ready;
    return {
      orderId: other.id, orderLabel: other.label, readyBefore, readyAfter,
      lostReadiness: readyBefore && !readyAfter,
      missingBefore, missingAfter, newMissing, sharedItems, hasNewMissing: newMissing.length > 0,
      requirementsBefore: beforeProgress.requirements, requirementsAfter: afterProgress.requirements,
    };
  });
  return { ...result, ok: true, cells, items, effects,
    hasNewMissing: effects.some(effect => effect.hasNewMissing),
    hasSharedItems: effects.some(effect => effect.sharedItems.length > 0) };
}

export function deliver(state, orderId) {
  const preview = previewDelivery(state, orderId);
  if (!preview.ok) return { ok: false, kind: 'deliver', reason: preview.reason, orderId };
  const orderIndex = state.orders.findIndex(order => order.id === orderId);
  const { cells, items: deliveredItems, orderLabel } = preview;
  const focusedId = state.orders[state.focusedOrder]?.id;
  for (const index of cells) state.board[index] = null;
  if (cells.includes(state.selected)) state.selected = -1;
  state.orders.splice(orderIndex, 1);
  const preservedFocus = state.orders.findIndex(order => order.id === focusedId);
  state.focusedOrder = preservedFocus >= 0 ? preservedFocus
    : Math.max(0, Math.min(state.focusedOrder, state.orders.length - 1));
  return { ok: true, kind: 'deliver', orderId, consumed: cells, orderLabel, deliveredItems,
    effects: preview.effects, hasNewMissing: preview.hasNewMissing };
}
