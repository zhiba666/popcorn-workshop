'use strict';

const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS } = require('./production-config');

const productName = product => PRODUCT_DEFINITIONS[product]?.name || '商品';
const defaults = () => ({ mode: null, orderId: null, previewOrderId: null, product: null, level: 1, protect: null,
  receipt: null, discarded: null, sourceId: null, recoveryReason: null, preparation: null,
  scroll: 0, locatedItemId: null, locatedUntil: 0, run: null });

// Presentation state stays outside the save. Every inventory/order mutation
// still runs through GameModel and the existing production/save session.
class BoardController {
  constructor(getModel) {
    this.getModel = getModel;
    this.flow = defaults();
  }
  reset() { Object.assign(this.flow, defaults()); }
  close(keepPreview = false) { this.flow.mode = null; this.flow.protect = null; this.flow.scroll = 0;
    if (!keepPreview) this.flow.previewOrderId = null; }
  open(mode) { this.flow.mode = mode; this.flow.scroll = 0;
    if (mode !== 'delivery') this.flow.previewOrderId = null; }
  locate(index, time) {
    const model = this.getModel(), item = model.state.board[index];
    if (!item) return { message: '商品已变化，请重新查看建议' };
    model.select(index); this.close(this.flow.mode === 'delivery');
    this.flow.locatedItemId = item.id; this.flow.locatedUntil = time + 1.8;
    return { result: { ok: true, action: 'select', to: index },
      message: item.kind === 'launcher' ? '已定位来源，重新按下取货' : '已定位商品，拿起后查看合成目标' };
  }
  openChain(product, level, orderId = null) {
    const model = this.getModel();
    if (!PRODUCT_DEFINITIONS[product] || !Number.isInteger(level) || level < 1 || level > CONFIG.maxProductLevel) return;
    Object.assign(this.flow, { product, level, orderId: model.getOrder(orderId)?.id ?? null });
    this.flow.preparation = this.flow.orderId == null ? null : { product, level, orderId: this.flow.orderId };
    this.open('chain');
  }
  nextGap(orderId) {
    const model = this.getModel(), effects = this.flow.receipt?.effects || [];
    let order = null, gap = null;
    for (const effect of effects) {
      const candidate = model.getOrder(effect.orderId);
      if (!candidate) continue;
      const missing = model.boardOrderProgress(candidate).missing;
      const next = effect.newMissing?.find(entry => missing.some(current =>
        current.product === entry.product && current.level === entry.level));
      if (next) { order = candidate; gap = next; break; }
    }
    if (!gap) {
      const candidates = [model.getOrder(orderId), model.getOrder(), ...model.getOrders()].filter(Boolean);
      order = candidates.find(candidate => model.boardOrderProgress(candidate).missing.length);
      gap = order && model.boardOrderProgress(order).missing[0];
    }
    if (!gap) return { message: '当前订单已齐货，可查看交付预览' };
    model.focusOrder(order.id); this.openChain(gap.product, gap.level, order.id);
    return { save: true };
  }
  protect(operation, preview) {
    const model = this.getModel(), item = model.state.board[preview.from];
    if (!item) return;
    this.flow.protect = { action: operation, from: preview.from, to: preview.to,
      sourceId: item.id, targetId: model.state.board[preview.to]?.id, item: { ...item }, orderIds: preview.orderIds || [] };
    this.open('protect');
  }
  handle(event, time) {
    const model = this.getModel(), f = this.flow, action = event.action;
    if (!action?.startsWith('board-')) return null;
    switch (action) {
      case 'board-orders': this.open('orders'); return {};
      case 'board-close': this.close(); return {};
      case 'board-order': {
        this.close(); f.preparation = null; f.receipt = null;
        const result = model.focusOrder(event.orderId);
        if (result.ok) {
          f.orderId = event.orderId;
          const progress = model.boardOrderProgress(event.orderId);
          if (progress.ready) { f.previewOrderId = event.orderId; this.open('delivery'); }
          else if (progress.missing[0]) this.openChain(progress.missing[0].product, progress.missing[0].level, event.orderId);
        }
        return { result };
      }
      case 'board-order-prev':
      case 'board-order-next':
        this.close(); f.preparation = null;
        return { result: model.cycleOrder(action === 'board-order-prev' ? -1 : 1) };
      case 'board-chain': {
        const item = model.state.board[model.state.selectedCell];
        this.openChain(event.product || item?.product, event.level || item?.level,
          event.orderId === undefined ? null : event.orderId);
        return {};
      }
      case 'board-chain-level':
        this.openChain(event.product || f.product, event.level,
          event.level === f.level ? f.orderId : null);
        return {};
      case 'board-preview':
        f.orderId = event.orderId ?? model.state.focusedOrderId;
        if (!model.getOrder(f.orderId)) return { message: '订单已更新，请重新选择' };
        f.previewOrderId = f.orderId;
        this.open('delivery'); return {};
      case 'board-receipt': if (f.receipt) this.open('receipt'); return {};
      case 'board-deliver':
        this.close(); return { result: model.deliver(event.orderId ?? model.state.focusedOrderId) };
      case 'board-discard': {
        const index = event.index ?? model.state.selectedCell, preview = model.previewDiscard(index);
        if (preview.kind === 'protected') { this.protect('discard', preview); return {}; }
        return { result: model.discard(index) };
      }
      case 'board-protect': {
        const operation = event.operation || 'merge';
        const preview = operation === 'discard' ? model.previewDiscard(event.from)
          : model.previewDrop(event.from, event.to);
        if (preview.kind === 'protected') this.protect(operation, preview);
        return {};
      }
      case 'board-confirm': {
        const pending = f.protect; this.close();
        if (!pending || model.state.board[pending.from]?.id !== pending.sourceId ||
            (pending.action === 'merge' && model.state.board[pending.to]?.id !== pending.targetId)) {
          return { message: '商品已变化，请重新选择' };
        }
        return { result: pending.action === 'discard' ? model.discard(pending.from) : model.drop(pending.from, pending.to) };
      }
      case 'board-restore': return { result: model.restoreDiscard() };
      case 'board-locate': {
        let index = event.itemId != null ? model.state.board.findIndex(item => item?.id === event.itemId)
          : event.lineId ? model.launcherIndex(event.lineId) : event.index;
        if (!Number.isInteger(index)) {
          const order = model.getOrder(f.orderId);
          const quantity = order?.requirements.filter(entry => entry.product === f.product && entry.level === f.level).length || 1;
          const plan = model.preparationPlan(f.product, f.level, quantity, f.orderId);
          index = plan.complete ? plan.ownedCells[0] : plan.nextMerge?.from;
        }
        return this.locate(index, time);
      }
      case 'board-next-gap': return this.nextGap(event.orderId);
      case 'board-recovery-order': {
        const order = [model.getOrder(), ...model.getOrders()].find(candidate => candidate && model.orderReady(candidate.id));
        if (!order) return { message: '尚无齐货订单，可先合成腾位' };
        model.focusOrder(order.id); f.orderId = order.id; f.previewOrderId = order.id; this.open('delivery'); return { save: true };
      }
      case 'board-recovery-merge':
        for (let from = 0; from < model.state.board.length; from++) {
          for (let to = from + 1; to < model.state.board.length; to++) {
            if (model.previewDrop(from, to).kind === 'merge') return this.locate(from, time);
          }
        }
        return { message: '暂无可直接合成商品，丢弃前先查看订单需求' };
      case 'board-recovery-source': return this.locate(model.launcherIndex(event.lineId || f.sourceId), time);
      case 'board-customer': this.close(); return { result: { ok: true, action: 'customer-open', customerId: event.customerId } };
      case 'board-page': {
        const result = model.setPage(event.page); this.reset();
        return { result: { ...result, action: 'page' } };
      }
      case 'board-pickup-end':
        if (event.count > 0) return { message: '本次取出' + event.count + '份' +
          (event.reason === 'board-full' ? ' · 满盘停发' : event.reason === 'empty-inventory' ? ' · 等待补货，重新按下取货' : ' · 已停止') };
        return {};
      default: return {};
    }
  }
  observe(result, time) {
    const f = this.flow, model = this.getModel();
    if (result.action === 'launch') {
      const lineId = result.lineId || model.state.selectedLineId, line = model.getLine(lineId);
      if (!line) return;
      if (!result.ok) {
        if (['empty-inventory', 'board-full'].includes(result.reason)) {
          f.sourceId = lineId; f.recoveryReason = model.state.board.every(Boolean) ? 'board-full' : result.reason;
        }
        return;
      }
      f.receipt = null;
      f.run = { lineId, count: result.pickupCount || result.count || (f.run?.lineId === lineId ? f.run.count + 1 : 1),
        label: productName(line.product), reason: result.stopReason || null };
      const full = model.state.board.every(Boolean), empty = line.inventory < 1;
      f.sourceId = full || empty ? lineId : null;
      f.recoveryReason = full ? 'board-full' : empty ? 'empty-inventory' : null;
    }
    if (!result.ok) return;
    if (['merge', 'move', 'discard', 'restore-discard'].includes(result.action)) f.receipt = null;
    if (result.action === 'deliver') {
      f.receipt = { ...result, at: time }; this.close();
      if (!model.getOrder(f.preparation?.orderId)) f.preparation = null;
    }
    if (result.action === 'page') this.reset();
    if (result.action === 'restore-discard') {
      f.locatedItemId = result.itemId; f.locatedUntil = time + 1.8;
    }
    f.discarded = model.discardedItem || null;
  }
  describe() {
    const model = this.getModel(), f = this.flow;
    if (model.state.page !== 'board') return '';
    const order = model.getOrder(f.orderId) || model.getOrder();
    if (f.mode === 'orders') return '全部订单已展开：' + model.getOrders().map(entry => {
      const progress = model.boardOrderProgress(entry);
      return progress.orderLabel + (progress.ready ? '已齐货' : '缺' + progress.missingCount + '件');
    }).join('；');
    if (f.mode === 'chain') {
      const quantity = order?.id === f.orderId ? order.requirements.filter(entry => entry.product === f.product && entry.level === f.level).length || 1 : 1;
      const plan = model.preparationPlan(f.product, f.level, quantity, f.orderId);
      return productName(f.product) + f.level + '级图鉴已打开，已备' + plan.owned + '份，还缺' + plan.missing + '份';
    }
    if (f.mode === 'delivery') {
      const preview = model.previewDelivery(order?.id);
      return preview.ok ? '交付预览：' + preview.items.map(item => productName(item.product) + item.level + '级' +
        (item.substituted ? '代交' + item.requiredLevel + '级' : '')).join('、') +
        (preview.hasNewMissing ? '，其他订单将新增缺口' : '，不增加其他订单缺口') : '订单尚未齐货';
    }
    if (f.mode === 'protect') return '订单保护确认已打开，继续操作将增加订单缺口';
    if (f.mode === 'receipt') return '实际交付回执：消耗' + (f.receipt?.consumed?.length || 0) + '件，腾出相同数量空格，收入' + (f.receipt?.reward || 0) + '金币';
    const empty = model.state.board.filter(item => !item).length;
    return '棋盘剩余' + empty + '格' + (model.discardedItem ? '，可恢复最近丢弃商品' : '') +
      (f.sourceId ? '，原来源' + f.sourceId + (empty === 0 ? '已停止取货，请先腾位' :
        model.getLine(f.sourceId)?.inventory > 0 ? '已有货，重新按下取货' : '等待真实产线入库，补货后重新按下取货') : '');
  }
}

module.exports = { BoardController };
