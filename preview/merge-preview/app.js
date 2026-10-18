import { PRODUCTS, SCENARIOS, createScenario, orderMatch, ready, previewDrop, drop, discard, restoreDiscard, launch, deliver,
  launcherStatus, advanceProduction, getSources, getProductChain, getPreparationPlan, previewDelivery, orderProgress } from './model.js';
import { createMergeEffects } from './merge-effects.js';
import { createLauncherEffects } from './launcher-effects.js';
import { createDeliveryEffects } from './delivery-effects.js';
import { createChainPanel } from './chain-panel.js';

// This workbench owns disposable example data only. It never loads the game or its save.
const $ = id => document.getElementById(id);
const board = $('board'), dialog = $('protection-dialog'), ordersDialog = $('orders-dialog');
$('order-items').setAttribute('aria-label', '本单需求，可左右滑动查看');
const productName = product => PRODUCTS.find(entry => entry.id === product)?.name || '商品';
const art = item => item ? `/assets/${item.kind === 'launcher' ? 'launchers' : 'products'}/${item.product}/lv-${String(item.level).padStart(2, '0')}.png` : '/assets/icons/popcorn.png';
const description = item => item ? productName(item.product) + (item.kind === 'launcher' ? '发射器' : '') + ' · Lv.' + item.level : '空格';
const reasons = { 'incompatible': '同种同级的商品才能合成', 'max-level': '这件已经达到五级',
  'board-full': '棋盘已满，合成、交付或丢弃腾位后重新取货', 'empty-stock': '正在生产，补货后重新按下取货',
  'launcher-protected': '发射器可以移动，不能丢弃', 'order-not-ready': '先备齐这张订单的成品' };
const LOW_SPACE_THRESHOLD = 3;
let scenario = SCENARIOS[0].id, state = createScenario(scenario);
let gesture = null, ghost = null, pending = null, keyboardSource = -1;
let idleTimer = null, pulseTimer = null, hoverIndex = -1, hoverKind = '';
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
let motionRate = 1;
let idlePair = [], feedback = '', demoToken = 0;
let discovered = new Set(), renderedOrderId = null, requirementViews = [];
let lastFrame = null, lastProductionPaint = 0;
let launchRun = null, locatedSourceId = null, locateUntil = 0;
let recoverySourceId = null, recoveryReason = null, stockNoticeSourceId = null;
let guideTrigger = null;
let preparationTarget = null;
let deliveryPreviewOpen = false, renderedDeliveryPreview = null;
let renderedOrderOverview = null, overviewTrigger = null, overviewChoosing = false;
const recentOutputs = new Map();
const orderAvailability = new Map();
const orderAnimations = new Map();
const cells = Array.from({ length: 63 }, (_, index) => {
  const cell = document.createElement('button');
  cell.type = 'button'; cell.className = 'cell'; cell.dataset.index = index;
  cell.innerHTML = '<span class="piece"><span class="piece-content"><img class="sprite" alt="" draggable="false"><span class="output-level" aria-hidden="true"></span><span class="level"></span></span></span>' +
    '<span class="launcher-outlet" aria-hidden="true"></span><span class="launcher-signal" aria-hidden="true"></span>' +
    '<span class="output-trace" aria-hidden="true"></span><span class="source-beacon" aria-hidden="true"></span>' +
    '<span class="order-mark" aria-hidden="true">单</span><span class="warning-mark" aria-hidden="true">!</span><span class="delivery-mark" aria-hidden="true">交</span>' +
    '<span class="selection-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
    '<span class="invalid-mark" aria-hidden="true">×</span>';
  board.append(cell);
  return { element: cell, piece: cell.querySelector('.piece'), sprite: cell.querySelector('.sprite'), level: cell.querySelector('.level'),
    outputLevel: cell.querySelector('.output-level'), outlet: cell.querySelector('.launcher-outlet'),
    order: cell.querySelector('.order-mark'), warning: cell.querySelector('.warning-mark') };
});
const mergeEffects = createMergeEffects({ board, cells, getGhost: () => ghost,
  isReducedMotion: () => reducedMotion, getPlaybackRate: () => motionRate });
const launcherEffects = createLauncherEffects({ cells, art,
  isReducedMotion: () => reducedMotion, getPlaybackRate: () => motionRate });
const deliveryEffects = createDeliveryEffects({ cells, art,
  isReducedMotion: () => reducedMotion, getPlaybackRate: () => motionRate });
const chainPanel = createChainPanel({ getState: () => state, getDiscovered: () => discovered,
  art, productName, getSources, getProductChain, getPreparationPlan,
  onOpen: () => { cancelGesture(); clearIdle(); },
  onClose: ({ reason }) => {
    if (!['locate', 'locate-item'].includes(reason)) (guideTrigger?.isConnected ? guideTrigger : $('inspect-chain')).focus({ preventScroll: true });
    scheduleIdle();
  },
  onLocate: ({ itemId, preparation }) => {
    cancelGesture(); clearIdle();
    if (preparation) preparationTarget = preparation;
    const index = state.board.findIndex(item => item?.kind === 'launcher' && item.id === itemId);
    if (index < 0) { say('发射器已变化，请重新查看来源'); return; }
    state.selected = index; locatedSourceId = itemId; locateUntil = performance.now() + 1800;
    renderBoard();
    cells[index].element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    cells[index].element.focus({ preventScroll: true });
    say(`已定位${productName(state.board[index].product)}${state.board[index].lineNumber}号线 · 出厂${state.board[index].level}级`);
  },
  onLocateItem: ({ itemId, preparation }) => locatePreparationItem(itemId, preparation),
});

// Warm the small preview's product art once; drag and order updates reuse their image nodes.
for (const product of PRODUCTS) for (let level = 1; level <= 5; level++) {
  const image = new Image(); image.src = art({ kind: 'product', product: product.id, level });
}

function say(text, { announce = true } = {}) {
  stockNoticeSourceId = null;
  if (announce && $('feedback-announcement').textContent !== text) $('feedback-announcement').textContent = text;
  if (feedback === text) return;
  feedback = text; $('feedback').classList.remove('delivery-feedback'); $('feedback').textContent = text;
}
function dismissStockNotice() {
  if (stockNoticeSourceId !== null) say('');
}
function showDelivery(result) {
  stockNoticeSourceId = null;
  deliveryPreviewOpen = false; renderedDeliveryPreview = null;
  const nextOrder = state.orders[state.focusedOrder];
  const nextStep = nextOrder ? `${nextOrder.label} · ${ready(state, nextOrder) ? '已齐货，可继续交付' : '继续备货'}`
    : '本组订单完成 · 可重置再试';
  const items = result.deliveredItems.map(item => `${productName(item.product)}${item.level}级`);
  feedback = `${result.orderLabel}已交付 · 腾出${result.consumed.length}格 · ${items.join('、')} · ${nextStep}`;
  $('feedback-announcement').textContent = feedback;
  const heading = document.createElement('div'); heading.className = 'delivery-heading';
  const title = document.createElement('strong'); title.textContent = `${result.orderLabel}已交付`;
  const capacity = document.createElement('span'); capacity.textContent = `腾出${result.consumed.length}格`;
  heading.append(title, capacity);
  const contents = document.createElement('div'); contents.className = 'delivery-items';
  result.deliveredItems.forEach(item => {
    const entry = document.createElement('span');
    const image = document.createElement('img'); image.src = art(item); image.alt = '';
    const label = document.createElement('span'); label.textContent = `${productName(item.product)}${item.level}级 ×1` +
      (item.substituted ? `（代交${item.requiredLevel}级）` : '');
    entry.append(image, label); contents.append(entry);
  });
  const next = document.createElement('p'); next.textContent = nextStep;
  $('feedback').classList.add('delivery-feedback'); $('feedback').replaceChildren(heading, contents, next);
  const affected = (result.effects || []).filter(effect => effect.hasNewMissing);
  if (affected.length) {
    const changes = document.createElement('div'); changes.className = 'delivery-after-effects';
    changes.textContent = affected.map(effect => `${effect.orderLabel}新增缺口：${missingText(effect.newMissing)}`).join('；');
    const action = document.createElement('button'); action.type = 'button'; action.className = 'delivery-action';
    action.textContent = '查看新增缺口';
    action.addEventListener('click', () => {
      cancelGesture();
      const stillMissing = (order, entry) => orderProgress(state, order).missing
        .some(missing => missing.product === entry.product && missing.level === entry.level);
      const target = affected.map(effect => {
        const order = state.orders.find(entry => entry.id === effect.orderId);
        return { order, missing: order && effect.newMissing.find(entry => stillMissing(order, entry)) };
      }).find(entry => entry.missing);
      const index = target ? state.orders.indexOf(target.order)
        : state.orders.findIndex(order => affected.some(effect => effect.orderId === order.id));
      if (index < 0) return;
      const order = state.orders[index];
      const missing = target?.missing || order.requirements.find(entry => stillMissing(order, entry));
      state.focusedOrder = index; render();
      if (missing) openGuide(missing.product, missing.level, action, order.id);
      else $('deliver').focus({ preventScroll: true });
    });
    $('feedback').append(changes, action);
  }
}
function missingText(requirements) {
  return requirements.map(entry => `${productName(entry.product)}≥${entry.level}级 ×${entry.quantity}`).join('、');
}
function renderDeliveryPreview() {
  const order = state.orders[state.focusedOrder];
  const preview = order ? previewDelivery(state, order.id) : null;
  if (!order) deliveryPreviewOpen = false;
  const button = $('preview-delivery'), panel = $('delivery-preview'), hint = $('delivery-impact-hint');
  button.hidden = !order;
  button.disabled = !preview?.ok && !deliveryPreviewOpen;
  button.textContent = deliveryPreviewOpen ? '收起' : '预览';
  button.setAttribute('aria-label', deliveryPreviewOpen ? '收起交付预览' : '查看交付预览');
  button.setAttribute('aria-expanded', String(deliveryPreviewOpen));
  const affected = preview?.ok ? preview.effects.filter(effect => effect.hasNewMissing) : [];
  const substitutions = preview?.ok ? preview.items.filter(item => item.substituted) : [];
  hint.hidden = deliveryPreviewOpen || (!affected.length && !substitutions.length);
  const risk = affected.length === 1 ? `交付后，${affected[0].orderLabel}将${affected[0].lostReadiness ? '重新缺货' : '新增缺口'}`
    : affected.length ? `交付后，${affected.length}单将新增缺口` : '';
  const warning = [substitutions.length ? `将用${substitutions.map(item => `${productName(item.product)}${item.level}级代交${item.requiredLevel}级`).join('、')}` : '', risk].filter(Boolean).join('；');
  if (hint.textContent !== warning) hint.textContent = warning;
  button.classList.toggle('has-risk', !!substitutions.length || !!affected.length);
  panel.hidden = !deliveryPreviewOpen;
  if (!deliveryPreviewOpen) { renderedDeliveryPreview = null; return null; }
  const signature = JSON.stringify({ orderId: order?.id, preview });
  if (signature === renderedDeliveryPreview) return preview;
  renderedDeliveryPreview = signature;
  const heading = document.createElement('strong');
  heading.textContent = preview?.ok ? `${order.label} · 将消耗${preview.cells.length}件，腾出${preview.cells.length}格`
    : `${order?.label || '订单'}尚未齐货`;
  panel.replaceChildren(heading);
  if (!preview?.ok) {
    const message = document.createElement('p'); message.textContent = '先补齐订单成品，再查看实际交付消耗。';
    panel.append(message); return preview;
  }
  const items = document.createElement('div'); items.className = 'delivery-items';
  for (const item of preview.items) {
    const entry = document.createElement('span'), icon = document.createElement('img'), label = document.createElement('span');
    icon.src = art(item); icon.alt = '';
    label.textContent = `${productName(item.product)}${item.level}级 ×1` +
      (item.substituted ? `（代交${item.requiredLevel}级）` : '') + ` · 第${Math.floor(item.index / 7) + 1}行第${item.index % 7 + 1}列`;
    entry.append(icon, label); items.append(entry);
  }
  panel.append(items);
  if (affected.length) {
    for (const effect of affected) {
      const impact = document.createElement('p'); impact.className = 'delivery-impact';
      impact.textContent = `${effect.orderLabel}：${effect.lostReadiness ? '由已齐货变为缺货' : '新增缺口'} · ${missingText(effect.newMissing)}`;
      panel.append(impact);
    }
  } else {
    const message = document.createElement('p'); message.textContent = preview.hasSharedItems
      ? '共享商品仍有余量，不增加其他订单缺口。' : '不增加其他订单缺口。';
    panel.append(message);
  }
  const note = document.createElement('p'); note.textContent = '绿色“交”标记为实际消耗；同级优先，再选最低合格等级。'; panel.append(note);
  const back = document.createElement('button'); back.type = 'button'; back.className = 'delivery-action'; back.textContent = '返回交付';
  back.addEventListener('click', () => {
    cancelGesture(); document.querySelector('.order-card').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    $('deliver').focus({ preventScroll: true });
  });
  panel.append(back);
  return preview;
}
function renderOrderOverview() {
  if (!ordersDialog.open) return;
  const entries = state.orders.map(order => ({ order, progress: orderProgress(state, order), preview: previewDelivery(state, order.id) }));
  const signature = JSON.stringify({ entries, focused: state.orders[state.focusedOrder]?.id });
  if (signature === renderedOrderOverview) return;
  renderedOrderOverview = signature;
  const readyCount = entries.filter(entry => entry.progress.ready).length;
  $('orders-dialog-summary').textContent = `${entries.length}单 · ${readyCount}单齐货 · 各单共用棋盘现货`;
  const cards = entries.map(({ order, progress, preview }) => {
    const card = document.createElement('article'); card.className = 'order-overview-card';
    card.dataset.current = String(order.id === state.orders[state.focusedOrder]?.id);
    const heading = document.createElement('div'); heading.className = 'order-overview-heading';
    const title = document.createElement('h3'); title.textContent = order.label;
    const status = document.createElement('span'); status.textContent = progress.ready ? '已齐货' : `缺${progress.missingCount}件`;
    status.dataset.ready = String(progress.ready); heading.append(title, status);
    const needs = document.createElement('div'); needs.className = 'order-overview-needs';
    for (const entry of progress.requirements) {
      const need = document.createElement('button'); need.type = 'button'; need.className = 'order-overview-need';
      need.textContent = `${productName(entry.product)}≥${entry.level}级` +
        (entry.ready ? entry.substituted ? ` · 用${entry.actualLevel}级` : ' ✓' : ' · 缺1');
      need.setAttribute('aria-label', `${order.label}，${need.textContent}，查看备货建议`);
      need.addEventListener('click', () => { select(); openGuide(entry.product, entry.level, $('ready-orders'), order.id); });
      needs.append(need);
    }
    const risk = document.createElement('p'); risk.className = 'order-overview-risk';
    const affected = preview.ok ? preview.effects.filter(effect => effect.hasNewMissing) : [];
    risk.textContent = affected.length ? `交付后影响${affected.map(effect => effect.orderLabel).join('、')}` : '';
    risk.hidden = !affected.length;
    const actions = document.createElement('div'); actions.className = 'order-overview-actions';
    const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = order.id === state.orders[state.focusedOrder]?.id ? '查看当前订单' : '查看这单';
    const select = () => {
      cancelGesture(); overviewChoosing = true; ordersDialog.close();
      state.focusedOrder = state.orders.findIndex(entry => entry.id === order.id);
      preparationTarget = null; deliveryPreviewOpen = false; renderedDeliveryPreview = null; render();
    };
    choose.addEventListener('click', () => {
      select(); document.querySelector('.order-card').scrollIntoView({ block: 'nearest', behavior: 'instant' });
      ($('compact-order-needs').offsetParent ? $('compact-order-needs') : $('order-title')).focus({ preventScroll: true });
    });
    const action = document.createElement('button'); action.type = 'button'; action.textContent = progress.ready ? '预览交付' : '查看缺口';
    action.addEventListener('click', () => {
      select();
      if (ready(state, order)) {
        deliveryPreviewOpen = true; renderBoard();
        $('delivery-preview').scrollIntoView({ block: 'nearest', behavior: 'instant' });
        $('preview-delivery').focus({ preventScroll: true });
      } else {
        const missing = orderProgress(state, order).missing[0];
        if (missing) openGuide(missing.product, missing.level, $('ready-orders'), order.id);
      }
    });
    actions.append(choose, action); card.append(heading, needs, risk, actions); return card;
  });
  if (!cards.length) {
    const empty = document.createElement('p'); empty.textContent = '本组订单已完成'; cards.push(empty);
  }
  $('orders-list').replaceChildren(...cards);
}
function openOrders(trigger) {
  cancelGesture(); clearIdle(); overviewTrigger = trigger; overviewChoosing = false;
  renderedOrderOverview = null; ordersDialog.showModal(); renderOrderOverview(); $('close-orders').focus();
}
function openGuide(product, level, trigger, orderId = null) {
  guideTrigger = trigger;
  if (orderId) preparationTarget = { product, level, orderId };
  chainPanel.open({ product, level, orderId });
}
function currentPreparation() {
  if (!preparationTarget) return null;
  const { product, level, orderId } = preparationTarget;
  const order = state.orders.find(entry => entry.id === orderId);
  const quantity = order?.requirements.filter(entry => entry.product === product && entry.level === level).length;
  if (!quantity) { preparationTarget = null; return null; }
  return { order, plan: getPreparationPlan(state, product, level, quantity, orderId) };
}
function locatePreparationItem(itemId, preparation = preparationTarget) {
  cancelGesture(); clearIdle();
  if (preparation) preparationTarget = preparation;
  const index = state.board.findIndex(item => item?.id === itemId);
  if (index < 0) { say('商品已变化，请重新查看备货建议'); return; }
  state.selected = index; locatedSourceId = itemId; locateUntil = performance.now() + 1800;
  renderBoard();
  cells[index].element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  cells[index].element.focus({ preventScroll: true });
  say(`${description(state.board[index])}已选中 · ` +
    (currentPreparation()?.plan.complete ? '目标成品已备好' : '拖到亮框松手合成'));
}
function renderPreparation() {
  const current = currentPreparation(), button = $('preparation-next');
  button.hidden = !current;
  if (!current) { $('preparation-status').textContent = '拖到同种同级商品，松手合成'; return; }
  const { order, plan } = current;
  const goal = `${productName(plan.product)}${plan.level}级`;
  if (plan.complete) {
    $('preparation-status').textContent = ready(state, order) ? `${order.label}已齐货 · 可以交付`
      : `${order.label} · ${goal}已备好，继续准备其他需求`;
    button.textContent = ready(state, order) ? '查看交付' : '查看下一缺口';
  } else if (plan.canCompleteFromBoard && plan.nextMerge) {
    $('preparation-status').textContent = `${order.label} · ${goal}材料已够，还需合成${plan.boardMergesNeeded}次`;
    button.textContent = '定位可合成商品';
  } else {
    $('preparation-status').textContent = `${order.label} · 还缺${goal} ×${plan.missing}`;
    button.textContent = '查看备货建议';
  }
}
function animateOrder(element, frames, duration) {
  if (reducedMotion) return;
  orderAnimations.get(element)?.cancel();
  const animation = element.animate(frames, { duration, easing: 'ease-out' });
  animation.playbackRate = motionRate;
  orderAnimations.set(element, animation);
  const finished = () => { if (orderAnimations.get(element) === animation) orderAnimations.delete(element); };
  animation.onfinish = finished; animation.oncancel = finished;
}
function clearEffects() {
  mergeEffects.clear();
  launcherEffects.clear();
  deliveryEffects.clear();
  for (const animation of orderAnimations.values()) animation.cancel();
  orderAnimations.clear();
  recentOutputs.clear(); locatedSourceId = null;
  cells.forEach(view => view.element.classList.remove('recent-output', 'located'));
}
function clearOrderEffects() {
  for (const animation of orderAnimations.values()) animation.cancel();
  orderAnimations.clear();
}
function renderOrders(celebrate = false) {
  const order = state.orders[state.focusedOrder];
  const orderId = order?.id || '';
  const changedOrder = renderedOrderId !== orderId;
  const previous = orderAvailability.get(orderId);
  const availability = new Map(state.orders.map(entry => {
    const progress = orderProgress(state, entry);
    return [entry.id, { ready: progress.ready, requirements: progress.requirements.map(requirement => requirement.ready), progress }];
  }));
  const newlyReady = celebrate ? state.orders.filter(entry => availability.get(entry.id).ready
    && orderAvailability.has(entry.id) && !orderAvailability.get(entry.id).ready) : [];
  if (changedOrder) {
    clearOrderEffects();
    renderedOrderId = orderId;
    requirementViews = (order?.requirements || []).map(requirement => {
      const element = document.createElement('button'); element.type = 'button'; element.className = 'requirement';
      element.addEventListener('click', () => openGuide(requirement.product, requirement.level, element, order.id));
      const img = document.createElement('img'); img.src = art(requirement); img.alt = productName(requirement.product);
      const level = document.createElement('span'); level.className = 'level'; level.textContent = requirement.level;
      const quantity = document.createElement('span'); quantity.className = 'quantity';
      const check = document.createElement('span'); check.className = 'ready-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
      element.append(img, level, quantity, check);
      return { element, img, quantity, check, requirement };
    });
    $('order-items').replaceChildren(...requirementViews.map(view => view.element));
  }
  $('order-title').textContent = order?.label || '本组订单已完成';
  $('compact-order-needs').hidden = !order;
  const compactNeeds = availability.get(orderId)?.progress.requirements.map(entry =>
    `${productName(entry.product)}${entry.substituted ? `${entry.actualLevel}代${entry.level}级` : `≥${entry.level}级`}`).join(' · ') || '';
  $('compact-order-needs').textContent = order ? `${order.label} · ${availability.get(orderId).ready ? '齐货' : '备货'}\n${compactNeeds}` : '';
  $('compact-order-needs').setAttribute('aria-label', `${order?.label || '订单'}，${compactNeeds}，查看完整需求`);
  $('order-count').textContent = order ? `${state.focusedOrder + 1} / ${state.orders.length}` : '已交付';
  $('prev-order').disabled = !order || state.focusedOrder === 0;
  $('next-order').disabled = !order || state.focusedOrder >= state.orders.length - 1;
  const isReady = !!order && ready(state, order);
  document.querySelector('.order-card').classList.toggle('ready', isReady);
  $('order-status').textContent = !order ? '订单已完成' : isReady ? '已齐货' : '备货中';
  $('deliver').disabled = !isReady;
  $('deliver').textContent = order ? '交付' : '已完成';
  $('deliver').classList.toggle('ready', isReady);
  const otherReady = state.orders.filter(entry => entry.id !== orderId && availability.get(entry.id).ready);
  const readyCount = [...availability.values()].filter(entry => entry.ready).length;
  $('ready-orders').hidden = !order;
  $('ready-orders').textContent = `订单${state.orders.length} · ${readyCount}齐货`;
  $('ready-orders').setAttribute('aria-label', `查看全部${state.orders.length}张订单，${readyCount}单已齐货`);
  $('ready-orders').classList.toggle('has-ready', otherReady.length > 0);
  for (const [index, view] of requirementViews.entries()) {
    const available = availability.get(orderId).requirements[index];
    const allocated = availability.get(orderId).progress.requirements[index];
    view.element.classList.toggle('ready', available);
    view.element.classList.toggle('substituted', allocated.substituted);
    view.element.setAttribute('aria-label', `${productName(view.requirement.product)}，需要${view.requirement.level}级及以上` +
      (available ? allocated.substituted ? `，用${allocated.actualLevel}级代交` : '，已备好' : '，未备好') + '，查看合成链与来源');
    view.quantity.textContent = available ? allocated.substituted ? `${allocated.actualLevel}级代交` : '✓ 1/1' : '0/1'; view.check.hidden = !available;
    if (celebrate && !changedOrder && available && !previous?.requirements[index]) {
      animateOrder(view.check, [{ transform: 'scale(.65)', opacity: .4 },
        { transform: 'scale(1.18)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }], 260);
    }
  }
  if (celebrate && !changedOrder && isReady && previous && !previous.ready) {
    animateOrder($('deliver'), [{ transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.045)', filter: 'brightness(1.2)', offset: .45 },
      { transform: 'scale(1)', filter: 'brightness(1)' }], 320);
  }
  orderAvailability.clear();
  for (const [id, value] of availability) orderAvailability.set(id, value);
  if (newlyReady.length) {
    say(`${feedback} · ${newlyReady.map(entry => entry.label).join('、')}已齐货，可交付`);
    if (newlyReady.some(entry => entry.id !== orderId)) animateOrder($('ready-orders'), [
      { transform: 'scale(.94)', filter: 'brightness(1)' },
      { transform: 'scale(1.05)', filter: 'brightness(1.15)', offset: .45 },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ], 340);
  }
  renderOrderOverview();
}
function renderDetails(safeCount, protectedCount) {
  const item = state.board[state.selected];
  const supply = item?.kind === 'launcher' ? launcherStatus(state, state.selected) : null;
  const selectedArt = art(item);
  if ($('selected-art').getAttribute('src') !== selectedArt) $('selected-art').src = selectedArt;
  $('selected-name').textContent = supply ? `${productName(item.product)}${item.lineNumber}号 · Lv.${item.level}` : item ? description(item) : '点选商品或发射器';
  $('selected-name').title = supply ? `${productName(item.product)}${item.lineNumber}号线 · 出厂${item.level}级` : item ? description(item) : '';
  $('discard').disabled = !item || item.kind !== 'product';
  $('discard').hidden = !item || item.kind !== 'product';
  $('inspect-chain').disabled = !item;
  let hint = '拖动时显示合成目标，金签表示订单现货。';
  if (supply) hint = supply.kind === 'ready' ? `库存 ${item.stock} 份 · ` +
    (state.board.filter(item => !item).length <= LOW_SPACE_THRESHOLD
      ? `当前最多可取 ${Math.min(item.stock, state.board.filter(item => !item).length)} 份` : '点击或长按取货') :
    supply.kind === 'board-full' ? '先合成、交付或丢弃腾位，再重新取货' : `库存已空 · 约 ${Math.ceil(supply.remainingSeconds)} 秒后补一份 · 补好后重新按下`;
  else if (item) {
    if (safeCount) hint = `有 ${safeCount} 件同种同级商品 · 拿起后显示亮框`;
    else if (protectedCount) hint = '同级商品用于订单 · 拖到琥珀格松手确认';
    else hint = orderMatch(state, item).length ? '订单所需成品 · 可以自由摆位' : item.level === 5 ? '本轮最高等级 · 可移动整理' : '暂无同种同级商品 · 可取货或整理';
  }
  if (hoverKind === 'protected') hint = '订单需要这件，松手可选择继续';
  else if (hoverKind === 'move') hint = '松手放入空格';
  else if (hoverKind === 'merge') hint = '松手与这件商品合成';
  else if (hoverKind === 'invalid') hint = '这里不能合成，换一个位置';
  $('item-hint').textContent = hint;
  paintSupplyDetails(supply);
}
function paintSupplyDetails(supply) {
  const badge = $('launcher-status'), meter = $('production-meter');
  badge.hidden = !supply; meter.hidden = !supply || supply.kind !== 'producing';
  if (!supply) return;
  badge.dataset.state = supply.kind;
  badge.textContent = { ready: '可取货', producing: '生产中', 'board-full': '满盘停发' }[supply.kind];
  if (!meter.hidden) meter.firstElementChild.style.transform = `scaleX(${supply.progress})`;
}
function recoveryMergePair() {
  for (let from = 0; from < state.board.length; from++) {
    if (state.board[from]?.kind !== 'product') continue;
    for (let to = from + 1; to < state.board.length; to++) {
      if (previewDrop(state, from, to).kind === 'merge') return [from, to];
    }
  }
  return null;
}
function recoveryOrderIndex() {
  return ready(state, state.orders[state.focusedOrder]) ? state.focusedOrder
    : state.orders.findIndex(order => ready(state, order));
}
function renderRecovery() {
  const emptyCount = state.board.filter(item => !item).length;
  const lowSpace = emptyCount > 0 && emptyCount <= LOW_SPACE_THRESHOLD;
  const spaceLabel = document.querySelector('.scene-label');
  spaceLabel.textContent = emptyCount === 0 ? '满盘' : lowSpace ? `余${emptyCount}格` : '7 × 9';
  spaceLabel.dataset.pressure = String(emptyCount <= LOW_SPACE_THRESHOLD);
  spaceLabel.hidden = false;
  let sourceIndex = state.board.findIndex(item => item?.kind === 'launcher' && item.id === recoverySourceId);
  if (!emptyCount && sourceIndex < 0) {
    sourceIndex = state.board[state.selected]?.kind === 'launcher' ? state.selected
      : state.board.findIndex(item => item?.kind === 'launcher' && item.stock > 0);
    if (sourceIndex < 0) sourceIndex = state.board.findIndex(item => item?.kind === 'launcher');
    recoverySourceId = state.board[sourceIndex]?.id ?? null;
    recoveryReason = 'board-full';
  }
  const panel = $('recovery');
  panel.hidden = emptyCount > 0 && !lowSpace && sourceIndex < 0;
  if (panel.hidden) return;
  const full = emptyCount === 0;
  const pressure = full || lowSpace;
  const canDeliver = pressure && recoveryOrderIndex() >= 0;
  const canMerge = pressure && !!recoveryMergePair();
  $('recovery-order').hidden = !canDeliver;
  $('recovery-merge').hidden = !canMerge;
  $('recovery-source').hidden = full || sourceIndex < 0;
  const supply = launcherStatus(state, sourceIndex);
  const source = state.board[sourceIndex];
  const sourceLabel = source ? `${productName(source.product)}${source.lineNumber}号线` : '发射器';
  $('recovery-source').textContent = `定位${sourceLabel}`;
  panel.dataset.state = full ? 'full' : lowSpace ? 'low-space' : supply?.kind === 'ready' ? 'ready' : 'producing';
  let hint = full
    ? canDeliver ? '棋盘已满 · 可先交付齐货订单腾位'
      : canMerge ? '棋盘已满 · 找到同种同级商品，合成腾位'
        : '棋盘已满 · 暂无可直接合成商品，可选中商品查看图鉴或丢弃腾位'
    : supply?.kind === 'ready' ? recoveryReason === 'empty-stock'
        ? `${sourceLabel}已补货 · 库存${supply.stock}份，重新按下取货`
        : `已有${emptyCount}个空格 · 重新按下${sourceLabel}取货`
      : recoveryReason === 'empty-stock' ? `${sourceLabel}库存已空 · 正在补货，补好后重新按下`
        : `已有${emptyCount}个空格 · 发射器正在补货，补好后重新按下`;
  if (lowSpace) {
    const selectedIndex = state.board[state.selected]?.kind === 'launcher' ? state.selected : sourceIndex;
    const currentSource = state.board[selectedIndex];
    const currentSupply = launcherStatus(state, selectedIndex);
    const quota = currentSource ? ` · ${productName(currentSource.product)}${currentSource.lineNumber}号线当前最多可取${Math.min(currentSupply.stock, emptyCount)}份` : '';
    const advice = canDeliver ? '先交付齐货订单腾位' : canMerge ? '先合成同种同级商品腾位' : '暂无可直接合成商品，丢弃前先查看订单需求';
    const recoveryLabel = selectedIndex === sourceIndex ? '' : sourceLabel;
    const resume = sourceIndex >= 0 ? ` · ${recoveryLabel}${supply.stock
      ? recoveryReason === 'empty-stock' ? '已补货，重新按下取货' : '已腾位，重新按下取货'
      : '正在补货，补好后重新按下'}` : currentSupply?.stock === 0 ? ' · 补货后重新按下取货' : '';
    hint = `仅剩${emptyCount}个空格${quota} · ${advice}${resume}`;
  }
  if ($('recovery-hint').textContent !== hint) $('recovery-hint').textContent = hint;
}
function renderDiscardRecovery() {
  const record = state.discardedItem, panel = $('discard-recovery');
  panel.hidden = !record;
  if (!record) return;
  const full = state.board.every(Boolean), image = $('discarded-art');
  const src = art(record.item);
  if (image.getAttribute('src') !== src) image.src = src;
  $('discarded-name').textContent = `已丢弃${description(record.item)}`;
  const hint = full ? '先腾出1格再恢复，商品仍保留' : '仅保留最近一次丢弃，可恢复这一件';
  if ($('discarded-hint').textContent !== hint) $('discarded-hint').textContent = hint;
  $('restore-discard').disabled = full;
}
function renderBoard(preserveMotionAt = -1) {
  const deliveryPreview = renderDeliveryPreview();
  const consumed = new Set(deliveryPreview?.ok && !gesture?.dragging && keyboardSource < 0 ? deliveryPreview.cells : []);
  const orderCells = new Set(state.orders.flatMap(order => orderProgress(state, order).requirements
    .filter(entry => entry.ready).map(entry => entry.cell)));
  const source = gesture?.dragging ? gesture.source : keyboardSource >= 0 ? keyboardSource : state.selected;
  const pairs = state.board.map((item, index) => item && index !== source ? previewDrop(state, source, index).kind : '');
  const safeCount = pairs.filter(kind => kind === 'merge').length;
  const protectedCount = pairs.filter(kind => kind === 'protected').length;
  const showCandidates = !!gesture?.dragging || keyboardSource >= 0
    || state.board[source]?.id === locatedSourceId;
  const searching = (!!gesture?.dragging || keyboardSource >= 0) && safeCount + protectedCount > 0;
  const sourceSupply = !gesture?.dragging && keyboardSource < 0 ? launcherStatus(state, source) : null;
  cells.forEach((view, index) => {
    const item = state.board[index], pair = pairs[index];
    const supply = item?.kind === 'launcher' ? launcherStatus(state, index) : null;
    launcherEffects.sync(index, item?.id);
    if (view.itemId !== item?.id && index !== preserveMotionAt) mergeEffects.cancel(index);
    view.itemId = item?.id;
    const match = orderCells.has(index);
    const selected = index === source && !!item;
    view.element.classList.toggle('selected', selected);
    view.element.classList.toggle('delivery-consumed', consumed.has(index));
    view.element.classList.toggle('pressed', !!gesture && !gesture.dragging && index === gesture.source && !!item);
    view.element.classList.toggle('source', !!gesture?.dragging && index === source);
    view.element.classList.toggle('safe', showCandidates && pair === 'merge');
    view.element.classList.toggle('protected', showCandidates && pair === 'protected');
    view.element.classList.toggle('unrelated', searching && !!item && index !== source && !['merge', 'protected'].includes(pair));
    view.element.classList.toggle('hover-target', index === hoverIndex && ['merge', 'protected'].includes(hoverKind));
    view.element.classList.toggle('hover-empty', index === hoverIndex && hoverKind === 'move');
    view.element.classList.toggle('hover-invalid', index === hoverIndex && hoverKind === 'invalid');
    view.element.classList.toggle('idle-hint', idlePair.includes(index));
    view.element.classList.toggle('next-output', sourceSupply?.kind === 'ready' && sourceSupply.nextCell === index);
    view.element.classList.toggle('recent-output', !!item && recentOutputs.get(item.id)?.index === index);
    view.element.classList.toggle('located', !!item && item.id === locatedSourceId);
    view.element.classList.toggle('launching', !!gesture?.longPress && !gesture.stopped && source === index);
    view.element.dataset.kind = item?.kind || 'empty';
    view.element.dataset.level = item?.level || '';
    view.element.dataset.product = item?.product || '';
    view.element.dataset.supply = supply?.kind || '';
    view.element.setAttribute('aria-pressed', String(selected));
    view.element.tabIndex = index === (state.selected >= 0 ? state.selected : 0) ? 0 : -1;
    view.element.setAttribute('aria-label', `第${Math.floor(index / 7) + 1}行第${index % 7 + 1}列，${description(item)}` +
      (supply ? `，${item.lineNumber}号线，库存${item.stock}份，${{ ready: '可取货', producing: '生产中', 'board-full': '满盘停发' }[supply.kind]}` : '') +
      (sourceSupply?.kind === 'ready' && sourceSupply.nextCell === index ? '，下一份出货落点' : '') +
      (match ? '，订单所需' : '') + (consumed.has(index) ? '，本次交付将消耗' : '') + (pair === 'merge' ? '，可直接合成' : pair === 'protected' ? '，合成需要确认' : ''));
    view.piece.hidden = !item; view.sprite.hidden = !item; view.level.hidden = !item;
    view.outputLevel.hidden = !supply;
    if (item) {
      const src = art(item); if (view.sprite.getAttribute('src') !== src) view.sprite.src = src;
      view.level.textContent = item.kind === 'launcher' ? `${item.stock}` : item.level;
      if (supply) view.outputLevel.textContent = `L${supply.outputLevel}`;
    }
    // Order ownership and a risky drop are separate facts; keep both marks visible.
    view.order.hidden = !match; view.warning.hidden = !showCandidates || pair !== 'protected';
  });
  $('merge-count').textContent = state.merges;
  $('empty-count').textContent = state.board.filter(item => !item).length;
  renderDetails(safeCount, protectedCount);
  renderRecovery();
  renderDiscardRecovery();
  renderPreparation();
}
function render(celebrate = false, preserveMotionAt = -1) { renderBoard(preserveMotionAt); renderOrders(celebrate); }
function clearIdle() {
  clearTimeout(idleTimer); clearTimeout(pulseTimer);
  idlePair = []; cells.forEach(view => view.element.classList.remove('idle-hint'));
}
function scheduleIdle() {
  clearIdle();
  if (state.selected >= 0 || gesture || dialog.open || ordersDialog.open || chainPanel.isOpen() || keyboardSource >= 0 || reducedMotion) return;
  const order = state.orders[state.focusedOrder];
  if (order && ready(state, order)) return;
  idleTimer = setTimeout(() => {
    if (gesture || dialog.open || ordersDialog.open || chainPanel.isOpen() || state.selected >= 0 || document.hidden) return;
    const candidates = state.board.map((item, index) => ({ item, index })).filter(({ item }) => item?.kind === 'product');
    candidates.sort((a, b) => Number(!!order?.requirements.some(r => r.product === b.item.product && r.level > b.item.level)) -
      Number(!!order?.requirements.some(r => r.product === a.item.product && r.level > a.item.level)));
    for (const { index } of candidates) {
      const target = candidates.find(candidate => previewDrop(state, index, candidate.index).kind === 'merge');
      if (target) { idlePair = [index, target.index]; break; }
    }
    renderBoard();
    pulseTimer = setTimeout(() => { idlePair = []; renderBoard(); }, 1600);
  }, 2000);
}
function afterAction(result, { contact } = {}) {
  if (!result.ok) {
    if (result.kind === 'restore-discard') {
      say(result.reason === 'board-full' ? '先腾出1格再恢复，丢弃商品仍保留' : '暂无可恢复的丢弃商品');
      renderBoard(); return;
    }
    const reason = result.kind === 'launch' && result.reason === 'empty-stock' && state.board.every(Boolean)
      ? 'board-full' : result.reason;
    const currentRun = result.kind === 'launch' && launchRun?.itemId === state.board[result.from]?.id
      && (gesture?.longPress || performance.now() - launchRun.lastShot <= 1000) ? launchRun : null;
    if (result.kind === 'launch') {
      if (gesture?.source === result.from) gesture.stopped = true;
      if (currentRun?.count) currentRun.reason = reason;
      if (reason === 'board-full' || reason === 'empty-stock') {
        recoverySourceId = state.board[result.from]?.id ?? null;
        recoveryReason = reason;
      }
    }
    say((currentRun?.count ? `本次取出${currentRun.count}份 · ` : '') + (reasons[reason] || '请换一个有效位置'));
    if (result.kind === 'launch' && reason === 'empty-stock') stockNoticeSourceId = recoverySourceId;
    if (result.kind === 'launch') { renderBoard(); launcherEffects.blocked(result.from); }
    return;
  }
  const deliverySnapshot = result.kind === 'deliver' ? deliveryEffects.capture(result) : null;
  let discovery = false;
  if (result.kind === 'merge') {
    state.selected = result.to;
    const key = `${result.product}/${result.level}`;
    discovery = !discovered.has(key); discovered.add(key);
    say(`${description(state.board[result.to])}合成完成` + (discovery ? ' · 首次合成这个等级' : ''));
  } else if (result.kind === 'move') { state.selected = result.to; say('已放入空格'); }
  else if (result.kind === 'launch') {
    const now = performance.now(), source = state.board[result.from];
    if (!launchRun || launchRun.itemId !== source.id || (!gesture?.longPress && now - launchRun.lastShot > 1000)) {
      launchRun = { itemId: source.id, count: 0, lastShot: now, label: `${productName(source.product)}${source.lineNumber}号线` };
    }
    launchRun.count++; launchRun.lastShot = now; launchRun.reason = null;
    recoverySourceId = null; recoveryReason = null;
    discovered.add(`${result.product}/${result.level}`);
    recentOutputs.set(result.itemId, { index: result.to, until: now + 1000 });
    const full = state.board.every(Boolean);
    const emptyStock = source.stock === 0;
    if (full || emptyStock) {
      recoverySourceId = source.id;
      recoveryReason = full ? 'board-full' : 'empty-stock';
      launchRun.reason = recoveryReason;
      if (gesture?.source === result.from) gesture.stopped = true;
    }
    say(`${launchRun.label} · 本次取出 ${launchRun.count} 份` +
      (full ? ' · 棋盘已满，已停发' : emptyStock ? ' · 库存已空，已停发 · 补货后重新按下'
        : gesture?.longPress ? ' · 松手停止' : ''), { announce: full || emptyStock || !gesture?.longPress || launchRun.count === 1 });
  }
  else if (result.kind === 'discard') { say('已丢弃，空出一格 · 可恢复最近丢弃的商品'); if (!state.board[state.selected]) state.selected = -1; }
  else if (result.kind === 'restore-discard') {
    locatedSourceId = result.itemId; locateUntil = performance.now() + 1800;
    say(`${description(state.board[result.to])}已恢复` + (result.to !== result.from ? ' · 原位置已占用，已放入其他空格' : ' · 已放回原位置'));
  }
  else if (result.kind === 'deliver') showDelivery(result);
  render(['merge', 'launch', 'restore-discard'].includes(result.kind), result.kind === 'merge' ? result.to : -1);
  if (result.kind === 'launch' && recoveryReason === 'empty-stock') stockNoticeSourceId = recoverySourceId;
  if (result.kind === 'merge') {
    moveGhost();
    mergeEffects.play(result, { discovery, orderReady: result.madeOrder, contact });
  }
  if (result.kind === 'launch') launcherEffects.play(result);
  if (result.kind === 'deliver') deliveryEffects.play(deliverySnapshot);
  scheduleIdle();
}
function askProtection(action, result) {
  const item = state.board[result.from];
  if (!item) return;
  pending = { action, from: result.from, to: result.to, sourceId: item.id, targetId: state.board[result.to]?.id };
  $('confirm-art').src = art(item); $('confirm-name').textContent = description(item);
  const affected = state.orders.filter(order => result.orderIds?.includes(order.id));
  $('protection-message').textContent = `${action === 'discard' ? '丢弃' : '继续合成'}后，${affected.map(order => order.label).join('、')}将新增缺口。高阶商品也能代交，但每件只能满足本单的一份需求。`;
  $('confirm').textContent = action === 'discard' ? '仍要丢弃' : '仍要合成';
  dialog.returnValue = ''; dialog.showModal(); $('keep').focus();
  clearIdle();
}
function snapshotPiece(piece) {
  if (!piece || piece.hidden) return undefined;
  const rect = piece.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  const clone = piece.cloneNode(true);
  const content = piece.querySelector('.piece-content');
  const contentTransform = content ? getComputedStyle(content).transform : 'none';
  if (content) clone.querySelector('.piece-content').style.transform = contentTransform;
  return { piece: clone, contentTransform, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
}
function contactFor(from, to, incoming) {
  return { incoming: incoming || snapshotPiece(cells[from]?.piece), target: snapshotPiece(cells[to]?.piece) };
}
function attemptDrop(from, to, incoming) {
  const contact = contactFor(from, to, incoming);
  const placement = { fromRect: incoming?.rect, contentTransform: incoming?.contentTransform };
  const result = drop(state, from, to);
  if (result.kind === 'protected') {
    mergeEffects.land(from, { ...placement, returning: true });
    askProtection('merge', result);
  } else {
    if (result.kind !== 'same') afterAction(result, { contact });
    if (result.kind !== 'merge') mergeEffects.land(result.ok ? to : from, { ...placement, returning: !result.ok || result.kind === 'same' });
    if (result.ok) cells[to].element.focus({ preventScroll: true });
  }
  return result;
}
function removeGhost() {
  ghost?.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
  ghost?.remove(); ghost = null;
}
function finishGesture({ keepDemo = false, released = false } = {}) {
  if (!keepDemo) { demoToken++; $('demo').disabled = false; }
  document.body.classList.remove('dragging');
  const previous = gesture; gesture = null;
  if (previous && !released) mergeEffects.cancel(previous.source);
  if (previous && board.hasPointerCapture(previous.id)) board.releasePointerCapture(previous.id);
  removeGhost(); hoverIndex = -1; hoverKind = '';
  renderBoard(); return previous;
}
function releaseGesture(options) {
  if (!gesture) return;
  if (gesture.dragging) { locateTarget(gesture); moveGhost(); }
  const incoming = snapshotPiece(ghost?.querySelector('.piece'));
  const g = finishGesture({ ...options, released: true });
  if (g.dragging) {
    if (g.target >= 0) attemptDrop(g.source, g.target, incoming);
    else {
      mergeEffects.land(g.source, { fromRect: incoming?.rect, contentTransform: incoming?.contentTransform, returning: true });
      say('已回到原位');
    }
  } else {
    mergeEffects.release(g.source);
    if (!g.longPress && !g.stopped && state.board[g.source]?.kind === 'launcher') afterAction(launch(state, g.source));
  }
  if (!g.dragging && g.longPress && launchRun?.count && !launchRun.reason) {
    say(`${launchRun.label} · 本次取出 ${launchRun.count} 份 · 已松手停止`);
  }
  scheduleIdle();
}
function cancelGesture() {
  const incoming = snapshotPiece(ghost?.querySelector('.piece'));
  const g = finishGesture({ released: true });
  if (g && state.board[g.source]?.id === g.itemId) {
    if (incoming) mergeEffects.land(g.source, { fromRect: incoming.rect, contentTransform: incoming.contentTransform, returning: true });
    else mergeEffects.release(g.source);
  }
  if (g?.longPress && launchRun?.count && !launchRun.reason) say(`${launchRun.label} · 本次取出 ${launchRun.count} 份 · 已停止`);
  keyboardSource = -1; renderBoard(); scheduleIdle();
}
function moveGhost() {
  if (!gesture?.dragging) return;
  document.body.classList.add('dragging');
  const item = state.board[gesture.source];
  if (!item) return;
  const lifted = !ghost;
  if (lifted) {
    ghost = document.createElement('div'); ghost.className = 'drag-ghost'; ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = '<span class="piece"><span class="piece-content"><img class="sprite" alt=""><span class="output-level" aria-hidden="true"></span><span class="level"></span></span></span>'; document.body.append(ghost);
  }
  const size = cells[gesture.source].element.getBoundingClientRect().width;
  ghost.style.width = `${size}px`; ghost.style.height = `${size}px`;
  // Keep the grabbed point under the pointer instead of snapping the image's centre to it.
  ghost.style.left = `${gesture.x - (gesture.grabX || 0)}px`;
  ghost.style.top = `${gesture.y - (gesture.grabY || 0)}px`;
  const sprite = ghost.querySelector('img'), src = art(item);
  if (sprite.getAttribute('src') !== src) sprite.src = src;
  ghost.querySelector('.level').textContent = item.kind === 'launcher' ? item.stock : item.level;
  ghost.dataset.kind = item.kind;
  ghost.querySelector('.output-level').hidden = item.kind !== 'launcher';
  ghost.querySelector('.output-level').textContent = `L${item.level}`;
  if (lifted) mergeEffects.lift(gesture.source, ghost.querySelector('.piece'));
}
function locateTarget(g) {
  const element = document.elementFromPoint(g.x, g.y)?.closest('.cell');
  const index = element && board.contains(element) ? Number(element.dataset.index) : -1;
  const result = index >= 0 ? previewDrop(state, g.source, index) : null;
  const kind = result?.kind || '';
  if (index !== g.target || kind !== g.targetKind) {
    g.target = index; g.targetKind = kind; g.hoverSince = performance.now();
  }
  hoverIndex = index; hoverKind = kind === 'same' ? '' : kind;
  // Do not flash red on every incompatible cell crossed on the way to a target.
  if (hoverKind === 'invalid' && performance.now() - g.hoverSince < 140) hoverKind = '';
}
board.addEventListener('pointerdown', event => {
  if ($('demo').disabled) cancelGesture();
  if (gesture || event.isPrimary === false || event.button !== 0 || dialog.open || ordersDialog.open) return;
  const element = event.target.closest('.cell'); if (!element) return;
  event.preventDefault(); clearIdle(); keyboardSource = -1;
  const source = Number(element.dataset.index);
  if (state.board[source]?.kind === 'launcher') launchRun = null;
  launcherEffects.settle(source);
  state.selected = state.board[source] ? source : -1;
  element.focus({ preventScroll: true });
  const now = performance.now();
  const bounds = element.getBoundingClientRect();
  gesture = { id: event.pointerId, source, itemId: state.board[source]?.id, startX: event.clientX, startY: event.clientY,
    x: event.clientX, y: event.clientY, started: now, nextShot: now + 400, dragging: false, longPress: false,
    grabX: event.clientX - bounds.left - bounds.width / 2, grabY: event.clientY - bounds.top - bounds.height / 2,
    stopped: false, target: -1, targetKind: '', hoverSince: now };
  board.setPointerCapture(event.pointerId); renderBoard();
  if (state.board[source]) mergeEffects.press(source);
  // An empty press stays stopped even if stock arrives before the hold threshold or release.
  if (state.board[source]?.kind === 'launcher' && state.board[source].stock < 1) afterAction(launch(state, source));
});
board.addEventListener('pointermove', event => {
  const g = gesture; if (!g || event.pointerId !== g.id) return;
  g.x = event.clientX; g.y = event.clientY;
  if (!g.dragging && state.board[g.source] && Math.hypot(g.x - g.startX, g.y - g.startY) > 8) {
    g.dragging = true;
    dismissStockNotice();
    if (g.longPress && launchRun?.count) say(`${launchRun.label} · 本次取出 ${launchRun.count} 份 · 已停发，拖动只移动`);
  }
  if (g.dragging) { event.preventDefault(); locateTarget(g); moveGhost(); renderBoard(); }
});
board.addEventListener('pointerup', event => {
  if (!gesture || event.pointerId !== gesture.id) return;
  gesture.x = event.clientX; gesture.y = event.clientY;
  releaseGesture();
});
board.addEventListener('pointercancel', cancelGesture);
board.addEventListener('lostpointercapture', () => { if (gesture) cancelGesture(); });
window.addEventListener('blur', cancelGesture);
window.addEventListener('resize', () => { cancelGesture(); clearEffects(); });
window.addEventListener('scroll', () => { if (gesture) cancelGesture(); }, { capture: true, passive: true });
// A later interaction owns the feedback, even if it only selects a different item.
document.addEventListener('pointerdown', dismissStockNotice, { capture: true });
document.addEventListener('keydown', dismissStockNotice, { capture: true });
document.addEventListener('visibilitychange', () => { lastFrame = null; if (document.hidden) { cancelGesture(); clearIdle(); clearEffects(); } else scheduleIdle(); });
board.addEventListener('keydown', event => {
  const element = event.target.closest('.cell'); if (!element) return;
  if (event.repeat && ['Enter', ' '].includes(event.key)) { event.preventDefault(); return; }
  if (gesture) cancelGesture();
  const index = Number(element.dataset.index), steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (event.key in steps) {
    event.preventDefault(); cells[Math.max(0, Math.min(62, index + steps[event.key]))].element.focus(); return;
  }
  if (event.key === 'Escape') { event.preventDefault(); cancelGesture(); state.selected = -1; renderBoard(); scheduleIdle(); }
  if (event.key === ' ') {
    launcherEffects.settle(index);
    event.preventDefault(); clearIdle(); state.selected = state.board[index] ? index : -1;
    keyboardSource = state.selected; renderBoard(); say(keyboardSource >= 0 ? '已拿起；方向键选择落点，Enter 放下' : '空格未拿起商品');
  }
  if (event.key === 'Enter') {
    launcherEffects.settle(index);
    event.preventDefault(); clearIdle();
    if (keyboardSource >= 0) { const source = keyboardSource; keyboardSource = -1; attemptDrop(source, index); renderBoard(); }
    else { state.selected = state.board[index] ? index : -1; if (state.board[index]?.kind === 'launcher') afterAction(launch(state, index)); else renderBoard(); }
  }
});
function frame(now) {
  const delta = lastFrame === null ? 0 : Math.min(1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!document.hidden && !dialog.open) {
    const refilled = advanceProduction(state, delta);
    if (refilled.length) {
      const noticeIndex = refilled.find(index => state.board[index]?.id === stockNoticeSourceId);
      renderBoard();
      if (gesture?.dragging) moveGhost();
      refilled.forEach(index => launcherEffects.refill(index));
      if (noticeIndex !== undefined && launcherStatus(state, noticeIndex)?.kind === 'ready') {
        say('');
      }
    }
    if (now - lastProductionPaint > 100) {
      const supply = launcherStatus(state, state.selected);
      if (supply) {
        paintSupplyDetails(supply);
        if (supply.kind === 'producing' && !gesture?.dragging) $('item-hint').textContent = `库存已空 · 约 ${Math.ceil(supply.remainingSeconds)} 秒后补一份 · 补好后重新按下`;
      }
      if (chainPanel.isOpen()) chainPanel.refresh();
      lastProductionPaint = now;
    }
  }
  let expired = false;
  for (const [id, mark] of recentOutputs) if (mark.until <= now || state.board[mark.index]?.id !== id) {
    recentOutputs.delete(id); expired = true;
  }
  if (locatedSourceId !== null && locateUntil <= now) { locatedSourceId = null; expired = true; }
  if (expired) renderBoard();
  const g = gesture;
  if (g && !document.hidden && !dialog.open && !ordersDialog.open && !chainPanel.isOpen()) {
    if (state.board[g.source]?.id !== g.itemId) cancelGesture();
    else if (g.dragging) {
      const previousHover = hoverIndex, previousKind = hoverKind;
      locateTarget(g);
      if (previousHover !== hoverIndex || previousKind !== hoverKind) renderBoard();
    } else if (!g.stopped && state.board[g.source]?.kind === 'launcher' && now >= g.nextShot) {
      g.longPress = true; const result = launch(state, g.source); afterAction(result);
      g.nextShot = now + 200; if (!result.ok) g.stopped = true;
    }
  }
  requestAnimationFrame(frame);
}
dialog.addEventListener('close', () => {
  const action = pending; pending = null;
  if (!action) return;
  if (dialog.returnValue !== 'confirm') { say('已保留订单成品'); render(); return; }
  if (state.board[action.from]?.id !== action.sourceId || (action.action === 'merge' && state.board[action.to]?.id !== action.targetId)) {
    say('商品已变化，请重新选择'); return;
  }
  const contact = action.action === 'merge' ? contactFor(action.from, action.to) : undefined;
  afterAction(action.action === 'merge' ? drop(state, action.from, action.to, true) : discard(state, action.from, true), { contact });
});
$('recovery-order').addEventListener('click', () => {
  cancelGesture(); clearIdle();
  const index = recoveryOrderIndex();
  if (index < 0) { renderBoard(); return; }
  state.focusedOrder = index; render();
  $('deliver').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  $('deliver').focus({ preventScroll: true });
  const order = state.orders[index];
  say(`${order.label}已齐货 · 交付可腾出${order.requirements.length}格`);
});
$('recovery-merge').addEventListener('click', () => {
  cancelGesture(); clearIdle();
  const pair = recoveryMergePair();
  if (!pair) { renderBoard(); return; }
  state.selected = pair[0];
  locatedSourceId = state.board[pair[0]].id; locateUntil = performance.now() + 1800; renderBoard();
  cells[pair[0]].element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  cells[pair[0]].element.focus({ preventScroll: true });
  say(`已选中${description(state.board[pair[0]])} · 拖到亮框松手，合成可腾出1格`);
});
$('recovery-source').addEventListener('click', () => {
  cancelGesture(); clearIdle();
  const index = state.board.findIndex(item => item?.kind === 'launcher' && item.id === recoverySourceId);
  if (index < 0) { renderBoard(); return; }
  state.selected = index; locatedSourceId = recoverySourceId; locateUntil = performance.now() + 1800;
  renderBoard();
  cells[index].element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  cells[index].element.focus({ preventScroll: true });
  const item = state.board[index];
  say(`已定位${productName(item.product)}${item.lineNumber}号线 · ` +
    (launcherStatus(state, index).kind === 'ready' ? '重新按下取货' : '正在补货，补好后重新按下'));
  if (launcherStatus(state, index).kind === 'producing') stockNoticeSourceId = item.id;
});
$('discard').addEventListener('click', () => {
  cancelGesture(); clearIdle(); const result = discard(state, state.selected);
  if (result.kind === 'protected') askProtection('discard', result); else afterAction(result);
});
$('restore-discard').addEventListener('click', () => {
  cancelGesture(); clearIdle();
  const result = restoreDiscard(state); afterAction(result);
  if (result.ok) {
    cells[result.to].element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    cells[result.to].element.focus({ preventScroll: true });
  }
});
$('deliver').addEventListener('click', () => {
  cancelGesture(); const order = state.orders[state.focusedOrder]; if (order) afterAction(deliver(state, order.id));
  if ($('deliver').disabled) {
    const target = $('compact-order-needs').offsetParent ? $('compact-order-needs') : $('order-title');
    target.focus({ preventScroll: true });
  }
});
$('preview-delivery').addEventListener('click', () => {
  cancelGesture(); clearIdle(); deliveryPreviewOpen = !deliveryPreviewOpen;
  renderedDeliveryPreview = null; render();
  if (deliveryPreviewOpen) $('delivery-preview').scrollIntoView({ block: 'nearest', behavior: 'instant' });
});
window.addEventListener('scroll', () => deliveryEffects.clear(), { passive: true });
window.addEventListener('resize', () => deliveryEffects.clear());
$('inspect-chain').addEventListener('click', () => {
  const item = state.board[state.selected];
  if (item) openGuide(item.product, item.level, $('inspect-chain'));
});
$('preparation-next').addEventListener('click', () => {
  cancelGesture();
  const current = currentPreparation(); if (!current) return;
  const { order, plan } = current;
  if (plan.complete && ready(state, order)) {
    state.focusedOrder = state.orders.indexOf(order); render();
    $('deliver').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    $('deliver').focus({ preventScroll: true });
  } else if (plan.complete) {
    const requirement = orderProgress(state, order).missing[0];
    if (requirement) openGuide(requirement.product, requirement.level, $('preparation-next'), order.id);
  } else if (plan.canCompleteFromBoard && plan.nextMerge) {
    locatePreparationItem(state.board[plan.nextMerge.from]?.id);
  } else openGuide(plan.product, plan.level, $('preparation-next'), order.id);
});
$('ready-orders').addEventListener('click', () => openOrders($('ready-orders')));
$('compact-order-needs').addEventListener('click', () => openOrders($('compact-order-needs')));
$('close-orders').addEventListener('click', () => ordersDialog.close());
ordersDialog.addEventListener('close', () => {
  if (!overviewChoosing) overviewTrigger?.focus({ preventScroll: true });
  overviewChoosing = false; scheduleIdle();
});
for (const [id, offset] of [['prev-order', -1], ['next-order', 1]]) $(id).addEventListener('click', () => {
  cancelGesture(); preparationTarget = null; state.focusedOrder = Math.max(0, Math.min(state.orders.length - 1, state.focusedOrder + offset));
  render(); scheduleIdle();
});
function reset(id = scenario) {
  overviewChoosing = true; if (ordersDialog.open) ordersDialog.close(); renderedOrderOverview = null;
  chainPanel.close();
  cancelGesture(); clearIdle(); pending = null; if (dialog.open) dialog.close('cancel');
  clearEffects();
  scenario = id; state = createScenario(id);
  lastFrame = null;
  launchRun = null;
  recoverySourceId = null; recoveryReason = null; stockNoticeSourceId = null;
  preparationTarget = null;
  deliveryPreviewOpen = false; renderedDeliveryPreview = null;
  discovered = new Set(state.board.filter(item => item?.kind === 'product').map(item => `${item.product}/${item.level}`));
  renderedOrderId = null;
  orderAvailability.clear();
  $('scenario-hint').textContent = SCENARIOS.find(entry => entry.id === id).hint;
  $('demo').textContent = id === 'launchers' ? '重置并演示长按取货' : '重置并播放手势示范';
  document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === id)));
  cells.forEach(view => view.element.classList.remove('pulse'));
  say('局面已就绪 · ' + SCENARIOS.find(entry => entry.id === id).title); render(); scheduleIdle();
}
for (const entry of SCENARIOS) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.scenario = entry.id;
  button.textContent = entry.title; button.addEventListener('click', () => reset(entry.id)); $('scenarios').append(button);
}
$('reset').addEventListener('click', () => reset());
$('demo').addEventListener('click', async () => {
  // Each example releases through the same path as pointerup, then picks up the result.
  reset(); const token = ++demoToken; $('demo').disabled = true;
  document.querySelector('.phone').scrollIntoView({ block: 'start', behavior: 'instant' });
  // Let the scroll event settle before creating a gesture that scrolling would cancel.
  await new Promise(resolve => requestAnimationFrame(resolve));
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (token !== demoToken) return;
  const center = index => {
    const bounds = cells[index].element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  };
  const pause = duration => new Promise(resolve => {
    const started = performance.now();
    const tick = time => {
      if (token !== demoToken || time - started >= duration) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (scenario === 'launchers') {
    const origin = center(8), started = performance.now();
    gesture = { id: -1, source: 8, itemId: state.board[8].id, ...origin,
      startX: origin.x, startY: origin.y, started, nextShot: started + 400,
      dragging: false, longPress: false, stopped: false, demo: true };
    state.selected = 8; mergeEffects.press(8); renderBoard();
    say('长按取货示范中 · 松开即停止');
    await pause(1250);
    if (token !== demoToken) return;
    releaseGesture({ keepDemo: true });
    finishGesture(); scheduleIdle(); return;
  }
  let source = 16;
  for (const index of (scenario === 'chain' ? [17, 18, 19] : [17])) {
    if (token !== demoToken) return;
    const origin = center(source), target = center(index), started = performance.now();
    gesture = { id: -1, source, itemId: state.board[source].id, ...origin, startX: origin.x, startY: origin.y,
      dragging: true, demo: true, target: -1, targetKind: '', hoverSince: started };
    say('手势示范中 · 拖到目标后松手合成'); moveGhost(); renderBoard();
    await new Promise(resolve => {
      const advance = time => {
        if (token !== demoToken) { resolve(); return; }
        const fraction = Math.min(1, (time - started) / 240);
        gesture.x = origin.x + (target.x - origin.x) * fraction;
        gesture.y = origin.y + (target.y - origin.y) * fraction;
        locateTarget(gesture); moveGhost(); renderBoard();
        if (fraction < 1) requestAnimationFrame(advance); else resolve();
      };
      requestAnimationFrame(advance);
    });
    // A visible hold makes the release point clear; hovering alone never merges.
    await pause(180);
    if (token !== demoToken) return;
    releaseGesture({ keepDemo: true });
    if (dialog.open) break;
    source = state.selected;
    await pause(360 / motionRate);
  }
  if (token !== demoToken) return;
  finishGesture(); scheduleIdle();
});
$('reduced-motion').checked = reducedMotion;
document.body.classList.toggle('reduced-motion', reducedMotion);
$('reduced-motion').addEventListener('change', event => {
  reducedMotion = event.target.checked; document.body.classList.toggle('reduced-motion', reducedMotion);
  clearEffects(); scheduleIdle();
});
motionPreference.addEventListener('change', event => {
  reducedMotion = event.matches; $('reduced-motion').checked = reducedMotion;
  document.body.classList.toggle('reduced-motion', reducedMotion); clearEffects(); scheduleIdle();
});
document.querySelectorAll('[data-motion-rate]').forEach(button => button.addEventListener('click', () => {
  cancelGesture(); clearEffects(); motionRate = Number(button.dataset.motionRate);
  document.querySelectorAll('[data-motion-rate]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
}));
document.querySelectorAll('[data-width]').forEach(button => button.addEventListener('click', () => {
  cancelGesture(); clearEffects(); document.querySelector('.phone').style.setProperty('--phone-width', button.dataset.width + 'px');
  document.querySelectorAll('[data-width]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
}));
reset(); requestAnimationFrame(frame);
