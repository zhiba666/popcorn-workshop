'use strict';

const { PRODUCTION_CONFIG: CONFIG } = require('./production-config');

const C = { ink: '#574332', muted: '#82745f', green: '#306b55', cream: '#fff7e7', amber: '#925e22' };
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const intersect = (a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y),
  w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
  h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) });
const progress = (m, order) => m.boardOrderProgress ? m.boardOrderProgress(order?.id) : m.orderProgress(order?.id);
const name = (r, product) => r.productName(product);
const missingText = (r, entries = []) => entries.map(e => `${name(r, e.product)}${e.level}级 ×${e.quantity || 1}`).join('、');
const orderName = (m, order) => order?.label || m.customerInfo(order?.customerId)?.customer?.name || '当前订单';
const stock = value => value >= 10000 ? Math.floor(value / 1000) + 'k' : String(value || 0);

function configureBoardViewport(r) {
  const w = r.width, h = r.height, top = Math.max(r.safeTop + 5, (r.menuBounds?.bottom || 0) + 4), compact = h - r.safeTop - r.safeBottom < 710;
  const navY = h - r.safeBottom - 50;
  const header = { x: 10, y: top, w: w - 20, h: 44 };
  const order = { x: 10, y: compact ? top : top + 48, w: w - 20, h: compact ? 66 : 82 };
  const details = { x: 10, y: order.y + order.h + 4, w: w - 20, h: 46 };
  const boardTop = compact ? order.y + order.h + 4 : details.y + details.h + 4, actionsY = navY - 48;
  const pitch = Math.max(16, Math.min((w - 32) / 7, (actionsY - boardTop - 8 - (compact ? 21 : 0)) / 9));
  const bw = pitch * 7 + 8, bh = pitch * 9 + 8;
  r.boardLayout = { compact, header, order, details, navY, actionsY,
    board: { x: (w - bw) / 2 + 4, y: boardTop + 4, pitch, size: pitch - 3, columns: 7, rows: 9 },
    frame: { x: (w - bw) / 2, y: boardTop, w: bw, h: bh },
    modal: { x: 10, y: r.safeTop + 8, w: w - 20, h: h - r.safeTop - r.safeBottom - 16 } };
  r.boardHits = [];
}

function boardCellRect(r, index) {
  const b = r.boardLayout.board;
  return { x: b.x + index % 7 * b.pitch, y: b.y + Math.floor(index / 7) * b.pitch, w: b.size, h: b.size };
}

function addHit(r, rect, hit, clip) {
  const area = clip ? intersect(rect, clip) : rect;
  if (area.w && area.h) r.boardHits.push({ rect: area, hit });
}

function button(r, label, rect, hit, enabled = true, muted = false, clip) {
  r.roundRect(rect.x, rect.y, rect.w, rect.h, 8, enabled ? muted ? '#f1e7cf' : '#e5eed9' : '#e4dfcf', enabled ? '#a5b490' : '#d1c5ae');
  const fontSize = Math.max(10, Math.min(12, (rect.w - 8) / Math.max(1, [...label].length)));
  r.text(label, rect.x + rect.w / 2, rect.y + rect.h / 2, fontSize, enabled ? C.green : C.muted, 'center', true);
  if (enabled && hit) addHit(r, rect, hit, clip);
}

function wrap(r, text, x, y, width, size = 12, color = C.muted, lineHeight = 18) {
  r.ctx.font = `${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  let line = '';
  for (const character of String(text || '')) {
    if (character === '\n' || line && r.ctx.measureText(line + character).width > width) {
      r.text(line, x, y, size, color); y += lineHeight; line = character === '\n' ? '' : character;
    } else line += character;
  }
  if (line) { r.text(line, x, y, size, color); y += lineHeight; }
  return y;
}

function item(r, model, value, rect, alpha = 1) {
  if (!value) return;
  r.contain(r.itemAsset(value), rect.x, rect.y - 1, rect.w, rect.h + 1, alpha);
  const c = r.ctx; c.save(); c.globalAlpha *= alpha;
  const launcher = value.kind === 'launcher', line = launcher && model.getLine(value.lineId);
  const bw = Math.min(25, rect.w - 2), bx = rect.x + rect.w - bw;
  r.roundRect(bx, rect.y + rect.h - 13, bw, 13, 4, launcher ? '#235e52' : '#765238');
  r.text(launcher ? stock(line?.inventory) : value.level, bx + bw / 2, rect.y + rect.h - 6.5, 9, C.cream, 'center', true);
  if (launcher) {
    r.roundRect(rect.x, rect.y, 20, 12, 3, '#235e52');
    r.text('L' + (line?.outputLevel || value.level), rect.x + 10, rect.y + 6, 8, C.cream, 'center', true);
  }
  c.restore();
}

function boardOrder(r, model) {
  const area = r.boardLayout.order, orders = model.getOrders(), order = model.getOrder();
  r.slice('ui/panel-cream', area.x, area.y, area.w, area.h);
  if (!order) { r.text('订单已完成', area.x + 10, area.y + 20, 14, C.green); return; }
  const p = progress(model, order), ready = !!p.ready;
  r.visibleOrderId = order.id; r.orderDeliverEnabled = ready;
  r.visibleCustomerId = order.customerId;
  const index = orders.findIndex(e => e.id === order.id);
  r.orderPreviousEnabled = index > 0; r.orderNextEnabled = index < orders.length - 1;
  r.text(`${orderName(model, order)} · ${ready ? '已齐货' : `缺${p.missingCount ?? p.requirements.filter(e => !e.ready).length}件`}`,
    area.x + 9, area.y + 13, 12, C.ink, 'left', true);
  r.text('+' + order.reward, area.x + area.w - 9, area.y + 13, 12, C.amber, 'right', true);
  const compact = r.boardLayout.compact;
  const rowY = area.y + area.h - 45, max = Math.max(1, p.requirements.length), leftW = Math.max(44, area.w - (compact ? 166 : 120));
  p.requirements.forEach((entry, i) => {
    const rr = { x: area.x + 5 + i * Math.min(48, leftW / max), y: rowY, w: Math.min(48, leftW / max), h: 44 };
    const found = entry.ready ?? entry.boardUnits === 1;
    r.contain('product/' + entry.product + '/' + entry.level, rr.x + 5, rr.y - 1, 32, 31);
    r.text(entry.substituted ? `${entry.actualLevel}代${entry.level}` : `${entry.level}级 ${found ? '✓' : '缺'}`, rr.x + rr.w / 2, rr.y + 36, 10,
      found ? C.green : C.muted, 'center', true);
    addHit(r, rr, { type: 'board-chain', product: entry.product, level: entry.level, orderId: order.id });
  });
  const extra = compact ? 48 : 0;
  button(r, '交付', { x: area.x + area.w - 113 - extra, y: rowY, w: 62, h: 44 }, { type: 'board-deliver', orderId: order.id }, ready);
  button(r, '预览', { x: area.x + area.w - 47 - extra, y: rowY, w: 44, h: 44 }, { type: 'board-preview', orderId: order.id }, ready, true);
  if (compact) button(r, '全部', { x: area.x + area.w - 47, y: rowY, w: 44, h: 44 }, { type: 'board-orders' }, true, true);
}

function selectedDetails(r, model) {
  const a = r.boardLayout.details, selected = model.state.board[model.state.selectedCell];
  r.slice('ui/panel-cream', a.x, a.y, a.w, a.h);
  const line = selected?.kind === 'launcher' ? model.getLine(selected.lineId) : model.getLine();
  const label = selected ? selected.kind === 'launcher' ? r.lineName(line) : `${name(r, selected.product)} · ${selected.level}级` : '点选商品或发射器';
  const empty = model.state.board.filter(e => !e).length;
  r.text(label, a.x + 7, a.y + 13, 12, C.ink, 'left', true);
  const hint = selected?.kind === 'launcher' ? `出厂${line.outputLevel}级 · 库存${stock(line.inventory)} · 最多取${Math.min(line.inventory, empty)}份`
    : selected ? '拿起商品后显示同级落点' : '拖动同种同级商品，松手合成';
  r.text(hint, a.x + 7, a.y + 33, r.width < 350 ? 10 : 11, C.muted);
  const chain = { x: a.x + a.w - 91, y: a.y + 1, w: 44, h: 44 };
  const discard = { x: a.x + a.w - 45, y: a.y + 1, w: 44, h: 44 };
  button(r, '图鉴', chain, selected && { type: 'board-chain', product: selected.product, level: selected.level }, !!selected, true);
  button(r, '丢弃', discard, { type: 'board-discard' }, selected?.kind === 'product', true);
}

function actions(r, model, flow) {
  const y = r.boardLayout.actionsY, w = r.width - 20, discarded = model.discardedItem || flow.discarded;
  const empty = model.state.board.filter(e => !e).length;
  const source = model.getLine(flow.sourceId || model.state.selectedLineId);
  const controls = [];
  const selected = model.state.board[model.state.selectedCell];
  if (r.boardLayout.compact && selected) {
    controls.push(['图鉴', { type: 'board-chain', product: selected.product, level: selected.level }]);
    if (selected.kind === 'product') controls.push(['丢弃', { type: 'board-discard' }]);
  }
  if (empty <= 3) {
    const readyOrder = model.getOrders().find(e => model.orderReady(e.id));
    if (readyOrder) controls.push(['交付腾位', { type: 'board-recovery-order', orderId: readyOrder.id }]);
    else controls.push(['找合成', { type: 'board-recovery-merge' }]);
  }
  if (empty > 0 && flow.sourceId) controls.push(['定位原来源', { type: 'board-recovery-source', lineId: flow.sourceId }]);
  else if (empty > 3 && flow.preparation) controls.push(['继续备货', { type: 'board-next-gap', orderId: flow.preparation.orderId }]);
  if (flow.receipt) controls.push(['交付回执', { type: 'board-receipt' }]);
  if (discarded) controls.push(['恢复丢弃', { type: 'board-restore', product: discarded.item.product, level: discarded.item.level }, empty > 0]);
  if (!controls.length) {
    r.text('点发射器取货 · 按住连取 · 拖动只移动', r.width / 2, y + 22, 11, C.muted, 'center');
    return;
  }
  const cw = (w - (controls.length - 1) * 6) / controls.length;
  controls.forEach(([label, hit, enabled], i) => {
    const rect = { x: 10 + i * (cw + 6), y, w: cw, h: 44 };
    if (hit.type === 'board-recovery-source') {
      button(r, '', rect, hit, enabled !== false);
      const sourceName = source ? '定位' + name(r, source.product) : '定位来源';
      const inventory = `库存${stock(source?.inventory)}份`;
      r.text(sourceName, rect.x + cw / 2, rect.y + 13, Math.min(11, (cw - 6) / [...sourceName].length), C.green, 'center', true);
      r.text(inventory, rect.x + cw / 2, rect.y + 31, Math.min(10, (cw - 6) / [...inventory].length), C.muted, 'center');
      return;
    }
    if (hit.type !== 'board-restore') { button(r, label, rect, hit, enabled !== false); return; }
    button(r, '', rect, hit, enabled !== false);
    r.contain(r.itemAsset(discarded.item), rect.x + 2, rect.y + 4, 28, 32, enabled === false ? .5 : 1);
    r.text(cw > 100 ? `恢复${discarded.item.level}级` : '恢复', rect.x + 30 + (cw - 32) / 2, rect.y + 22, 11,
      enabled === false ? C.muted : C.green, 'center', true);
  });
}

function modal(r, model, flow) {
  const a = r.boardLayout.modal, c = r.ctx;
  c.fillStyle = '#3e352cb5'; c.fillRect(0, 0, r.width, r.height);
  r.slice('ui/panel-cream', a.x, a.y, a.w, a.h);
  const title = { orders: '全部订单', chain: '合成图鉴与备货', delivery: '交付预览', receipt: '交付回执', protect: '保留订单所需商品？' }[flow.mode] || '棋盘详情';
  r.text(title, a.x + 13, a.y + 25, 16, C.green, 'left', true);
  button(r, '关闭', { x: a.x + a.w - 57, y: a.y + 4, w: 50, h: 44 }, { type: 'board-close' }, true, true);
  const clip = { x: a.x + 8, y: a.y + 53, w: a.w - 16, h: a.h - 61 };
  const scroll = Math.max(0, flow.scroll || 0), originY = clip.y - scroll;
  c.save(); c.beginPath(); c.rect(clip.x, clip.y, clip.w, clip.h); c.clip();
  let y = originY + 12;
  const text = (value, size = 12, color = C.muted) => { y = wrap(r, value, clip.x + 5, y, clip.w - 10, size, color) + 6; };
  const control = (label, hit, enabled = true) => {
    button(r, label, { x: clip.x + 4, y, w: clip.w - 8, h: 44 }, { ...hit, boardScrollable: true }, enabled, false, clip); y += 50;
  };
  const card = heading => { r.text(heading, clip.x + 5, y, 14, C.ink, 'left', true); y += 25; };
  const order = model.getOrder(flow.orderId) || model.getOrder();
  if (flow.mode === 'orders') {
    text('各单共用棋盘现货，高阶商品也可代交。');
    for (const entry of model.getOrders()) {
      const p = progress(model, entry), preview = model.previewDelivery?.(entry.id);
      card(`${orderName(model, entry)} · ${p.ready ? '已齐货' : `缺${p.missingCount}件`}`);
      text(p.requirements.map(e => `${name(r, e.product)}≥${e.level}级 ${e.ready ? e.substituted ? '用' + e.actualLevel + '级' : '✓' : '缺1'}`).join(' · '));
      const affected = preview?.effects?.filter(e => e.hasNewMissing) || [];
      if (affected.length) text('交付后新增缺口：' + affected.map(e => e.orderLabel).join('、'), 12, C.amber);
      button(r, '查看这单', { x: clip.x + 4, y, w: clip.w - 66, h: 44 },
        { type: 'board-order', orderId: entry.id, boardScrollable: true }, true, false, clip);
      button(r, '顾客', { x: clip.x + clip.w - 58, y, w: 54, h: 44 },
        { type: 'board-customer', customerId: entry.customerId, boardScrollable: true }, true, true, clip);
      y += 62;
    }
  } else if (flow.mode === 'receipt') {
    const receipt = flow.receipt;
    if (!receipt) text('暂无交付回执。');
    else {
      const goods = receipt.deliveredItems || receipt.items || receipt.consumed || [];
      card((receipt.orderLabel || '订单') + '已交付');
      text(`腾出${receipt.consumed?.length ?? goods.length}格 · 收入${receipt.totalReward ?? receipt.reward ?? 0}金币`, 13, C.green);
      for (const entry of goods) {
        item(r, model, { ...entry, kind: 'product' }, { x: clip.x + 4, y, w: 38, h: 38 });
        y = wrap(r, `${name(r, entry.product)}${entry.level}级 ×1` +
          (entry.requiredLevel && entry.level > entry.requiredLevel ? `，代交${entry.requiredLevel}级` : ''),
        clip.x + 50, y + 16, clip.w - 56, 12, C.ink) + 18;
      }
      const affected = (receipt.effects || []).filter(e => e.hasNewMissing);
      if (affected.length) {
        for (const effect of affected) text(`${effect.orderLabel}新增缺口：${missingText(r, effect.newMissing)}`, 12, C.amber);
        control('查看新增缺口并继续备货', { type: 'board-next-gap', orderId: receipt.orderId });
      } else text('未增加其他订单缺口。', 12, C.green);
      control('返回棋盘', { type: 'board-close' });
    }
  } else if (flow.mode === 'delivery') {
    const p = order && model.previewDelivery?.(order.id);
    card(orderName(model, order));
    if (!p?.ok) text('尚未齐货，先准备订单所需成品。');
    else {
      text(`本次消耗${p.cells.length}件商品，腾出${p.cells.length}格。`, 13, C.green);
      for (const entry of p.items) {
        const rr = { x: clip.x + 4, y, w: 38, h: 38 }; item(r, model, { ...entry, kind: 'product' }, rr);
        y = wrap(r, `${name(r, entry.product)}${entry.level}级` + (entry.substituted ? `，代交${entry.requiredLevel}级` : '') + ` · 第${Math.floor(entry.index / 7) + 1}行第${entry.index % 7 + 1}列`, clip.x + 50, y + 14, clip.w - 56, 12, C.ink) + 15;
      }
      const affected = p.effects.filter(e => e.hasNewMissing);
      if (!affected.length) text(p.hasSharedItems ? '共享商品仍有余量，不增加其他订单缺口。' : '不增加其他订单缺口。', 12, C.green);
      for (const effect of affected) text(`${effect.orderLabel}：${effect.lostReadiness ? '将重新缺货' : '新增缺口'} · ${missingText(r, effect.newMissing)}`, 12, C.amber);
      control('交付这单', { type: 'board-deliver', orderId: order.id });
      control('定位本次交付商品', { type: 'board-locate', index: p.cells[0], itemId: p.items[0]?.id });
    }
  } else if (flow.mode === 'protect') {
    const p = flow.protect || {};
    if (p.item) { item(r, model, p.item, { x: clip.x + 4, y, w: 55, h: 55 }); y += 62; }
    text(`${p.action === 'discard' ? '丢弃' : '继续合成'}后，部分订单会新增缺口。高阶商品可以代交，但每件只能满足本单的一份需求。`, 13, C.amber);
    const affected = model.getOrders().filter(e => p.orderIds?.includes(e.id));
    if (affected.length) text(affected.map(e => orderName(model, e)).join('、'));
    control('保留商品', { type: 'board-close' });
    control(p.action === 'discard' ? '仍要丢弃' : '仍要合成', { type: 'board-confirm' });
  } else if (flow.mode === 'chain') {
    const product = flow.product || model.getLine().product, level = flow.level || 1;
    card(`${name(r, product)} · ${level}级`);
    const levels = CONFIG.maxProductLevel, columns = Math.min(5, levels), cellW = (clip.w - 8) / columns;
    for (let l = 1; l <= levels; l++) button(r, String(l) + '级', { x: clip.x + 4 + (l - 1) % columns * cellW, y: y + Math.floor((l - 1) / columns) * 49, w: cellW - 3, h: 44 },
      { type: 'board-chain-level', product, level: l, orderId: l === level ? flow.orderId : null, boardScrollable: true }, true, l !== level, clip);
    y += Math.ceil(levels / columns) * 49 + 5;
    const plan = model.preparationPlan?.(product, level, 1, flow.orderId);
    if (flow.orderId && plan) {
      text(`本单需要${plan.quantity}份 · 已备${Math.min(plan.owned, plan.quantity)}份 · 还缺${plan.missing}份`, 13, C.green);
      text(plan.complete ? '成品已备好，无需继续取货或合成。' : plan.canCompleteFromBoard ? `材料已够，再合成${plan.boardMergesNeeded}次。` : '扣除可用棋盘材料后，按下方数量补货。');
      if (plan.complete) control('查看已备成品', { type: 'board-locate', index: plan.ownedCells?.[0], itemId: plan.qualifiedItems?.[0]?.id });
      else if (plan.nextMerge) control('定位可合成商品', { type: 'board-locate', index: plan.nextMerge.from });
      if (plan.reservedCount) text(`保留${plan.reservedCount}件订单所需现货。`, 12, C.amber);
    }
    if (!flow.orderId || !plan?.complete && !plan?.canCompleteFromBoard) {
      const sources = plan?.sources || model.boardSources?.(product, level) || [];
      if (!sources.length) text('棋盘上暂无这个口味的发射器。');
      for (const source of sources) {
        const line = model.getLine(source.lineId);
        card(`${r.lineName(line)} · 出厂${source.level}级`);
        const status = source.status?.kind;
        text(`库存${stock(source.stock)}份 · ${status === 'board-full' ? '满盘停发，先腾位' : status === 'producing' ? '生产中，入库后重新按下' : '可取货'}`);
        const draws = source.drawsNeeded ?? (source.level >= level ? 1 : 2 ** (level - source.level));
        text(source.level > level ? `再取${draws}份${source.level}级成品可代交，无需合成。`
          : `${source.boardItemsUsed ? `利用${source.boardItemsUsed}件材料，` : ''}再取${draws}份 · 合成${source.mergesNeeded ?? Math.max(0, draws - 1)}次`, 12, C.green);
        if (source.futureReserveCount) text('路线需留：' + missingText(r, source.safetyReserveByLevel?.map(e => ({ ...e, product, quantity: e.count }))), 12, C.amber);
        control('定位发射器 · 不会自动取货', { type: 'board-locate', index: source.index, lineId: source.lineId, itemId: source.itemId }); y += 8;
      }
    }
  }
  c.restore();
  r.boardScrollMax = Math.max(0, y - originY + 8 - clip.h);
  if ((flow.scroll || 0) > r.boardScrollMax) flow.scroll = r.boardScrollMax;
  r.boardModalContent = clip;
  addHit(r, clip, { type: 'board-scroll', boardScrollable: true });
  if (r.boardScrollMax > 0) {
    const thumb = Math.max(24, clip.h * clip.h / (clip.h + r.boardScrollMax));
    r.roundRect(a.x + a.w - 6, clip.y + (clip.h - thumb) * Math.min(1, scroll / r.boardScrollMax), 3, thumb, 2, '#b9aa87');
  }
}

function drawBoardView(r, model, visual = {}) {
  if (!r.boardLayout) configureBoardViewport(r);
  const c = r.ctx, dpr = r.canvas.width / r.width, flow = r.boardFlow || {};
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = 1;
  c.fillStyle = '#f1e8d8'; c.fillRect(0, 0, r.width, r.height);
  r.image('ui/background-table', 0, 0, r.width, r.height);
  r.boardHits = []; r.boardModalContent = null;
  const h = r.boardLayout.header, empty = model.state.board.filter(e => !e).length;
  if (!r.boardLayout.compact) {
    r.text('合成台', h.x + 3, h.y + 21, 18, C.green, 'left', true);
    r.text(empty <= 3 ? empty ? `余${empty}格` : '满盘' : String(model.state.coins) + '金币', h.x + 87, h.y + 21, 11, empty <= 3 ? C.amber : C.muted);
  }
  const readyCount = model.getOrders().filter(e => model.orderReady(e.id)).length;
  if (!r.boardLayout.compact) button(r, `订单${model.getOrders().length} · ${readyCount}齐`, { x: r.width - 111, y: h.y, w: 101, h: 44 }, { type: 'board-orders' });
  boardOrder(r, model);
  if (!r.boardLayout.compact) selectedDetails(r, model);
  const frame = r.boardLayout.frame; r.slice('ui/board-frame', frame.x, frame.y, frame.w, frame.h);
  const g = visual.gesture || {}, dragging = !!g.dragging, from = g.sourceIndex;
  const allocated = new Set(model.getOrders().flatMap(o => progress(model, o)?.cells || []));
  const previewId = flow.mode === 'delivery' ? flow.orderId || model.getOrder().id : flow.previewOrderId;
  const preview = previewId != null && model.previewDelivery?.(previewId);
  const consumed = new Set(preview?.ok ? preview.cells : []);
  model.state.board.forEach((value, index) => {
    const rr = boardCellRect(r, index); r.slice('ui/board-cell', rr.x, rr.y, rr.w, rr.h);
    if (index === model.state.selectedCell) r.contain('board-state/cell-selected', rr.x - 2, rr.y - 2, rr.w + 4, rr.h + 4);
    if (dragging && value && index !== from) {
      const candidate = model.previewDrop?.(from, index);
      if (candidate?.kind === 'merge' || candidate?.kind === 'protected') {
        c.lineWidth = 1.5; r.roundRect(rr.x + 1, rr.y + 1, rr.w - 2, rr.h - 2, 5, null, candidate.kind === 'protected' ? '#c68b37' : '#bf9a55');
      }
    }
    const flying = (visual.effects || []).some(e => e.type === 'launch' && e.index === index && value?.id === e.itemId && (visual.time || 0) - e.startedAt < e.duration);
    if (!flying) item(r, model, value, rr, dragging && from === index ? .22 : 1);
    if (allocated.has(index)) { r.roundRect(rr.x, rr.y, 12, 13, 3, '#edbf58'); r.text('单', rr.x + 6, rr.y + 6.5, 8, '#694c24', 'center'); }
    if (consumed.has(index)) { r.roundRect(rr.x, rr.y + rr.h - 13, 12, 13, 3, '#397e71'); r.text('交', rr.x + 6, rr.y + rr.h - 6.5, 8, C.cream, 'center'); }
    if (flow.locatedItemId && value?.id === flow.locatedItemId && (visual.time || 0) < flow.locatedUntil) {
      c.lineWidth = 2; r.roundRect(rr.x - 2, rr.y - 2, rr.w + 4, rr.h + 4, 6, null, '#438366');
    }
    addHit(r, rr, { type: 'cell', index });
  });
  r.effects(visual, model);
  if (dragging && model.state.board[from]) {
    const p = r.boardPoint(g.x, g.y), hit = hitBoardView(r, g.x, g.y);
    if (hit?.type === 'cell' && hit.index !== from) {
      const target = boardCellRect(r, hit.index), result = model.previewDrop?.(from, hit.index);
      r.contain(['move', 'merge', 'protected'].includes(result?.kind) ? 'effect/focus-ring' : 'effect/invalid-target', target.x - 3, target.y - 3, target.w + 6, target.h + 6);
    }
    item(r, model, model.state.board[from], { x: p.x - 23, y: p.y - 27, w: 46, h: 46 });
  }
  if (r.boardLayout.compact) {
    const selected = model.state.board[model.state.selectedCell], line = selected?.kind === 'launcher' && model.getLine(selected.lineId);
    const summary = line ? `${r.lineName(line)} · 出厂${line.outputLevel}级 · 库存${stock(line.inventory)} · 最多取${Math.min(line.inventory, empty)}份`
      : selected ? `${name(r, selected.product)}${selected.level}级 · 拿起后显示合成目标` : '点发射器取货，拖动商品合成';
    r.text(summary + ` · 余${empty}格`, r.width / 2, r.boardLayout.actionsY - 10, 10, empty <= 3 ? C.amber : C.muted, 'center');
  }
  actions(r, model, flow);
  const ny = r.boardLayout.navY, nw = (r.width - 32) / 3;
  const unread = model.customerCollection().some(info => info.unread);
  ['factory', 'board', 'customers'].forEach((page, i) => {
    const rect = { x: 10 + i * (nw + 6), y: ny, w: nw, h: 44 };
    r.slice(page === 'board' ? 'ui/nav-active' : 'ui/nav-idle', rect.x, rect.y, rect.w, rect.h);
    r.text({ factory: '工厂', board: '棋盘', customers: '顾客' }[page], rect.x + rect.w / 2, rect.y + 22, 15, page === 'board' ? C.cream : C.ink, 'center', true);
    if (page === 'customers' && unread) r.roundRect(rect.x + rect.w - 17, rect.y + 8, 6, 6, 3, '#c17932');
    addHit(r, rect, { type: 'board-page', page });
  });
  const toast = visual.toast, value = typeof toast === 'string' ? toast : toast?.text || toast?.message;
  if (value && (!toast.at || (visual.time || 0) - toast.at < (toast.duration || 2.3)) && !flow.mode) {
    c.save(); c.font = '12px sans-serif'; const tw = Math.min(r.width - 24, c.measureText(value).width + 20);
    const twoLines = c.measureText(value).width > tw - 20, th = twoLines ? 48 : 30;
    r.roundRect((r.width - tw) / 2, frame.y + frame.h - th - 7, tw, th, 9, '#493c2de8');
    wrap(r, value, (r.width - tw) / 2 + 10, frame.y + frame.h - th + 8, tw - 20, 12, C.cream, 17); c.restore();
  }
  if (flow.mode) { r.boardHits = []; modal(r, model, flow); }
}

function hitBoardView(r, x, y) {
  const point = { x, y };
  for (const entry of r.boardHits || []) if (inside(point, entry.rect)) return { ...entry.hit };
  return null;
}

module.exports = { configureBoardViewport, boardCellRect, drawBoardView, hitBoardView };
