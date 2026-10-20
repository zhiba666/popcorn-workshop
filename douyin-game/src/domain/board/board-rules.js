'use strict';

const { PRODUCTION_CONFIG: CONFIG } = require('../production/production-config');
const { getCustomer } = require('../customers/customer-config');

function createBoardRules(rules) {
  const PRODUCTS = rules.products, MAX_LEVEL = rules.maxLevel;
  const validCell = index => Number.isInteger(index) && index >= 0 && index < rules.boardSize;
  const qualifies = (item, requirement) => item != null && item.kind === 'product'
    && item.product === requirement.product && item.level >= requirement.level;

  function orderProgress(state, orderOrId) {
    const order = typeof orderOrId === 'object' ? orderOrId
      : state.orders.find(entry => entry.id === orderOrId);
    if (!order) return null;
    const requirements = order.requirements.map((requirement, requirementIndex) => ({
      ...requirement, requirementIndex, ready: false, cell: -1,
      itemId: null, actualLevel: null, substituted: false,
    }));
    const available = state.board.flatMap((item, index) => item != null && item.kind === 'product' ? [{ item, index }] : [])
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
    let orderLabel = order.label;
    if (!orderLabel) {
      const customer = getCustomer(order.customerId);
      orderLabel = (customer == null ? undefined : customer.name) || ('订单 ' + order.id);
    }
    return { orderId: order.id, orderLabel, ready: used.size === requirements.length,
      matchedCount: used.size, missingCount: requirements.length - used.size,
      requirements, missing, cells: requirements.filter(entry => entry.ready).map(entry => entry.cell),
      substitutionCount: requirements.filter(entry => entry.substituted).length };
  }

  function requiredCells(state, order) {
    const progress = orderProgress(state, order);
    return progress != null && progress.ready ? progress.cells : null;
  }

  function missingIncrease(before, after) {
    return after.missing.flatMap(entry => {
      const previous = before.missing.find(other => other.product === entry.product && other.level === entry.level);
      const previousQuantity = previous == null ? undefined : previous.quantity;
      const quantity = entry.quantity - (previousQuantity != null ? previousQuantity : 0);
      return quantity > 0 ? [{ product: entry.product, level: entry.level, quantity }] : [];
    });
  }

  function affectedOrders(state, board) {
    const after = { ...state, board };
    return state.orders.filter(order => missingIncrease(orderProgress(state, order), orderProgress(after, order)).length)
      .map(order => order.id);
  }

  function previewDrop(state, from, to) {
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
    if (state.nextItemId >= Number.MAX_SAFE_INTEGER) return { ...result, reason: 'numeric-limit' };
    const afterBoard = [...state.board];
    afterBoard[from] = null;
    afterBoard[to] = { ...source, level: source.level + 1 };
    const orderIds = affectedOrders(state, afterBoard);
    if (orderIds.length) {
      return { ...result, kind: 'protected', reason: 'order-needed', orderIds };
    }
    return { ...result, kind: 'merge', orderIds: [] };
  }


  function previewDiscard(state, index) {
    const result = { kind: 'invalid', ok: false, from: index };
    if (!validCell(index)) return { ...result, reason: 'invalid-cell' };
    const item = state.board[index];
    if (!item) return { ...result, reason: 'empty-cell' };
    Object.assign(result, { sourceId: item.id, itemId: item.id, product: item.product, level: item.level });
    if (item.kind !== 'product') return { ...result, reason: 'launcher-protected' };
    const board = [...state.board];
    board[index] = null;
    const orderIds = affectedOrders(state, board);
    return orderIds.length ? { ...result, kind: 'protected', reason: 'order-needed', orderIds }
      : { ...result, kind: 'discard', ok: true, orderIds: [] };
  }

  function nextLaunchCell(state, index) {
    if (!validCell(index)) return -1;
    const launcher = state.board[index];
    if (launcher == null || launcher.kind !== 'launcher') return -1;
    const row = Math.floor(index / rules.columns), column = index % rules.columns;
    const candidates = state.board.flatMap((item, target) => {
      if (item !== null) return [];
      const dx = target % rules.columns - column, dy = Math.floor(target / rules.columns) - row;
      return [{ index: target, distance: dx * dx + dy * dy,
        angle: (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2) }];
    }).sort((left, right) => left.distance - right.distance || left.angle - right.angle);
    const candidate = candidates[0];
    const candidateIndex = candidate == null ? undefined : candidate.index;
    return candidateIndex != null ? candidateIndex : -1;
  }

  function getSources(state, product, targetLevel) {
    return state.board.flatMap((item, index) => {
      if (item == null || item.kind !== 'launcher' || item.product !== product) return [];
      const line = state.lines.find(entry => entry.id === item.lineId);
      if (!line) return [];
      const canSupply = Number.isInteger(targetLevel) && targetLevel >= 1 && targetLevel <= MAX_LEVEL;
      const nextCell = nextLaunchCell(state, index);
      const factory = line.factory;
      const phaseProgress = factory.duration > 0 ? Math.max(0, Math.min(1, factory.elapsed / factory.duration)) : 0;
      const phaseRemainingSeconds = factory.duration > 0 ? Math.max(0, factory.duration - factory.elapsed) : null;
      const arriving = line.warehouse.filter(batch => !batch.credited
        && batch.baseUnits >= 2 ** (line.outputLevel - 1))
        .map(batch => Math.max(0, batch.duration - batch.elapsed));
      const status = {
        kind: line.inventory < 1 ? 'producing' : nextCell < 0 ? 'board-full' : 'ready',
        stock: line.inventory, outputLevel: line.outputLevel, product: line.product, nextCell,
        phase: factory.phase, progress: phaseProgress, phaseProgress, phaseRemainingSeconds,
        remainingSeconds: arriving.length ? Math.min(...arriving) : null,
        waitingPackaging: line.buffer.filter(batch => batch.status === 'waiting').length,
        warehouseCount: line.warehouse.length,
      };
      const definition = CONFIG.lines.find(entry => entry.id === line.id);
      const lineNumber = definition == null ? undefined : definition.number;
      return [{ index, itemId: item.id, lineId: line.id, product: line.product, level: line.outputLevel,
        outputLevel: line.outputLevel, stock: line.inventory, inventory: line.inventory,
        lineNumber: lineNumber != null ? lineNumber : 1,
        status, canSupply, mergesNeeded: canSupply ? 2 ** Math.max(0, targetLevel - line.outputLevel) - 1 : null }];
    }).sort((left, right) => left.lineNumber - right.lineNumber || left.index - right.index);
  }

  function getPreparationPlan(state, product, targetLevel, quantity = 1, orderId = null) {
    const context = orderId == null ? null : orderProgress(state, orderId);
    const matchingRequirements = context == null ? undefined : context.requirements.filter(entry => entry.product === product && entry.level === targetLevel);
    const contextRequirements = matchingRequirements != null ? matchingRequirements : [];
    const requested = contextRequirements.length || (Number.isInteger(quantity) && quantity > 0 ? quantity : 1);
    const valid = PRODUCTS.includes(product)
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
    const remainingRequirements = state.orders.map(order => {
      let futureGoods = requested;
      return [...orderProgress(state, order).requirements]
        .filter(requirement => requirement.product === product)
        .sort((left, right) => right.level - left.level || left.requirementIndex - right.requirementIndex)
        .filter(requirement => {
          if (requirement.level > targetLevel || futureGoods < 1) return true;
          futureGoods--;
          return false;
        });
    });

    if (valid) {
      state.board.forEach((item, index) => {
        if (item != null && item.kind === 'product' && item.product === product && item.level < targetLevel) {
          cellsByLevel[item.level].push(index);
        }
      });
      for (let level = 1; level < targetLevel; level++) {
        // Keep the existing goods needed by an order out of the suggested route.
        // This is guidance only; previewDrop remains the authority for every merge.
        const needed = Math.max(0, ...remainingRequirements.map(requirements => requirements
          .filter(requirement => requirement.ready ? requirement.actualLevel === level : requirement.level === level).length));
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
      const priorityDrawCount = source.level > targetLevel ? (context == null ? undefined : context.requirements.filter(requirement =>
        requirement.product === product && !requirement.ready
        && requirement.level > targetLevel && requirement.level <= source.level).length) : 0;
      const priorityDraws = priorityDrawCount != null ? priorityDrawCount : 0;
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
    const boardMergesNeeded = boardWork == null ? undefined : boardWork.mergesNeeded;
    const boardItemsUsed = boardWork == null ? undefined : boardWork.boardItemsUsed;
    const safetyReserveByLevel = boardWork == null ? undefined : boardWork.safetyReserveByLevel;
    const futureReserveCount = boardWork == null ? undefined : boardWork.futureReserveCount;
    const nextMerge = availableMerges[0];
    return {
      valid, product, level: targetLevel, quantity: requested, owned, missing,
      ownedCells: qualifiedItems.map(item => item.index), qualifiedItems,
      complete: valid && !missing,
      canCompleteFromBoard,
      boardMergesNeeded: boardMergesNeeded != null ? boardMergesNeeded : null,
      boardItemsUsed: boardItemsUsed != null ? boardItemsUsed : 0,
      safetyReserveByLevel: safetyReserveByLevel != null ? safetyReserveByLevel : [],
      futureReserveCount: futureReserveCount != null ? futureReserveCount : 0,
      reservedCount, hasReservedMaterials: reservedCount > 0, reservedByLevel,
      availableMerges, protectedMerges, nextMerge: nextMerge != null ? nextMerge : null, sources,
    };
  }

  function previewDelivery(state, orderId) {
    const result = {
      ok: false, kind: 'delivery-preview', orderId, orderLabel: '',
      cells: [], items: [], effects: [], hasNewMissing: false, hasSharedItems: false,
    };
    const order = state.orders.find(entry => entry.id === orderId);
    if (!order) return { ...result, reason: 'order-not-found' };
    result.orderLabel = order.label;
    if (!result.orderLabel) {
      const customer = getCustomer(order.customerId);
      result.orderLabel = (customer == null ? undefined : customer.name) || ('订单 ' + order.id);
    }
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
      let orderLabel = other.label;
      if (!orderLabel) {
        const customer = getCustomer(other.customerId);
        orderLabel = (customer == null ? undefined : customer.name) || ('订单 ' + other.id);
      }
      return {
        orderId: other.id, orderLabel, readyBefore, readyAfter,
        lostReadiness: readyBefore && !readyAfter,
        missingBefore, missingAfter, newMissing, sharedItems, hasNewMissing: newMissing.length > 0,
        requirementsBefore: beforeProgress.requirements, requirementsAfter: afterProgress.requirements,
      };
    });
    return { ...result, ok: true, cells, items, effects,
      hasNewMissing: effects.some(effect => effect.hasNewMissing),
      hasSharedItems: effects.some(effect => effect.sharedItems.length > 0) };
  }


  return { orderProgress, previewDelivery, previewDrop, previewDiscard,
    preparationPlan: getPreparationPlan, boardSources: getSources };
}

module.exports = { createBoardRules };

