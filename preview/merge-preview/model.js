export const PRODUCTS = [
  { id: 'original', name: '原味', index: 0 },
  { id: 'caramel', name: '焦糖', index: 1 },
];

export const SCENARIOS = [
  { id: 'chain', title: '连续合成', hint: '从选中的原味一级开始，依次拖向右侧一级、二级、三级，完成原味四级。' },
  { id: 'protected', title: '订单保护', hint: '两份原味三级合成会耗尽订单现货；未查看订单所需的唯一焦糖三级也受保护。' },
  { id: 'surplus', title: '有余量可合', hint: '三份原味三级中合掉两份，仍留一份用于订单，无须确认。' },
  { id: 'full', title: '满盘与边界', hint: '满盘不能发射，但仍能合成腾位；五级商品不能再合成，发射器可移到空格。' },
];

const COLUMNS = 7;
const BOARD_SIZE = 63;
const MAX_LEVEL = 5;
const validCell = index => Number.isInteger(index) && index >= 0 && index < BOARD_SIZE;
const matches = (item, requirement) => item?.kind === 'product'
  && item.product === requirement.product && item.level === requirement.level;

export function createScenario(id = 'chain') {
  const scenario = SCENARIOS.some(entry => entry.id === id) ? id : 'chain';
  const state = {
    board: Array(BOARD_SIZE).fill(null),
    orders: [], selected: 16, focusedOrder: 0, nextId: 1, merges: 0,
  };
  const put = (index, product, level, kind = 'product', stock) => {
    state.board[index] = { id: state.nextId++, kind, product, level };
    if (kind === 'launcher') state.board[index].stock = stock;
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
    put(31, 'caramel', 3); put(40, 'caramel', 2); put(41, 'original', 5);
    state.orders = [
      order('order-a', '双味分享', [need('original', 3), need('caramel', 4)]),
      order('order-b', '焦糖小单', [need('caramel', 3)]),
    ];
  }

  put(8, 'original', 1, 'launcher', 12);
  put(12, 'caramel', 1, 'launcher', 8);
  return state;
}

export function orderMatch(state, item) {
  if (item?.kind !== 'product') return [];
  return state.orders.filter(order => order.requirements.some(requirement => matches(item, requirement)))
    .map(order => order.id);
}

export function count(state, product, level) {
  return state.board.filter(item => matches(item, { product, level })).length;
}

function requiredCells(state, order) {
  const available = new Set();
  for (const requirement of order.requirements) {
    const index = state.board.findIndex((item, cell) => !available.has(cell) && matches(item, requirement));
    if (index < 0) return null;
    available.add(index);
  }
  return [...available];
}

export function ready(state, order) {
  return Boolean(order && requiredCells(state, order));
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
  const orderIds = orderMatch(state, source);
  if (orderIds.length && count(state, source.product, source.level) === 2) {
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
  const madeOrder = orderMatch(state, item).length > 0 && count(state, item.product, item.level) === 0;
  state.board[to] = item;
  state.board[from] = null;
  state.selected = to;
  state.merges++;
  return { ...preview, kind: 'merge', reason: undefined, ok: true, level: item.level, itemId: item.id, madeOrder };
}

export function discard(state, index, confirmed = false) {
  const result = { kind: 'invalid', from: index, ok: false };
  if (!validCell(index)) return { ...result, reason: 'invalid-cell' };
  const item = state.board[index];
  if (!item) return { ...result, reason: 'empty-cell' };
  Object.assign(result, { sourceId: item.id, product: item.product, level: item.level });
  if (item.kind === 'launcher') return { ...result, reason: 'launcher-protected' };
  const orderIds = orderMatch(state, item);
  if (orderIds.length && count(state, item.product, item.level) === 1 && !confirmed) {
    return { ...result, kind: 'protected', reason: 'order-needed', orderIds };
  }
  state.board[index] = null;
  if (state.selected === index) state.selected = -1;
  return { ...result, kind: 'discard', ok: true, orderIds };
}

export function launch(state, index) {
  const result = { kind: 'launch', from: index, ok: false };
  if (!validCell(index)) return { ...result, reason: 'invalid-cell' };
  const launcher = state.board[index];
  if (launcher?.kind !== 'launcher') return { ...result, reason: 'missing-launcher' };
  if (launcher.stock < 1) return { ...result, reason: 'empty-stock' };
  const row = Math.floor(index / COLUMNS), column = index % COLUMNS;
  const candidates = [];
  state.board.forEach((item, target) => {
    if (item) return;
    const dx = target % COLUMNS - column, dy = Math.floor(target / COLUMNS) - row;
    candidates.push({ index: target, distance: dx * dx + dy * dy,
      angle: (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2) });
  });
  if (!candidates.length) return { ...result, reason: 'board-full' };
  candidates.sort((left, right) => left.distance - right.distance || left.angle - right.angle);
  const to = candidates[0].index;
  const item = { id: state.nextId++, kind: 'product', product: launcher.product, level: launcher.level };
  state.board[to] = item;
  launcher.stock--;
  state.selected = index;
  return { ...result, ok: true, to, sourceId: launcher.id, itemId: item.id, product: item.product, level: item.level };
}

export function deliver(state, orderId) {
  const orderIndex = state.orders.findIndex(order => order.id === orderId);
  if (orderIndex < 0) return { ok: false, kind: 'deliver', reason: 'order-not-found', orderId };
  const cells = requiredCells(state, state.orders[orderIndex]);
  if (!cells) return { ok: false, kind: 'deliver', reason: 'order-not-ready', orderId };
  const focusedId = state.orders[state.focusedOrder]?.id;
  for (const index of cells) state.board[index] = null;
  if (cells.includes(state.selected)) state.selected = -1;
  state.orders.splice(orderIndex, 1);
  const preservedFocus = state.orders.findIndex(order => order.id === focusedId);
  state.focusedOrder = preservedFocus >= 0 ? preservedFocus
    : Math.max(0, Math.min(state.focusedOrder, state.orders.length - 1));
  return { ok: true, kind: 'deliver', orderId, consumed: cells };
}
