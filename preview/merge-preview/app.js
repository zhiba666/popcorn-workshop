import { PRODUCTS, SCENARIOS, createScenario, orderMatch, count, ready, previewDrop, drop, discard, launch, deliver } from './model.js';

// This workbench owns disposable example data only. It never loads the game or its save.
const $ = id => document.getElementById(id);
const board = $('board'), dialog = $('protection-dialog');
const productName = product => PRODUCTS.find(entry => entry.id === product)?.name || '商品';
const art = item => item ? `/assets/${item.kind === 'launcher' ? 'launchers' : 'products'}/${item.product}/lv-${String(item.level).padStart(2, '0')}.png` : '/assets/icons/popcorn.png';
const description = item => item ? productName(item.product) + (item.kind === 'launcher' ? '发射器' : '') + ' · Lv.' + item.level : '空格';
const reasons = { 'incompatible': '同种同级的商品才能合成', 'max-level': '这件已经达到五级',
  'board-full': '棋盘已满，合成或交付后再取货', 'empty-stock': '这个发射器的示例库存已用完',
  'launcher-protected': '发射器可以移动，不能丢弃', 'order-not-ready': '先备齐这张订单的成品' };
let scenario = SCENARIOS[0].id, state = createScenario(scenario);
let gesture = null, ghost = null, pending = null, keyboardSource = -1;
let idleTimer = null, pulseTimer = null, hoverIndex = -1, hoverKind = '', dwell = 260;
let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let idlePair = [], feedback = '', progressIndex = -1, demoToken = 0, highlightedSource = '';
const cells = Array.from({ length: 63 }, (_, index) => {
  const cell = document.createElement('button');
  cell.type = 'button'; cell.className = 'cell'; cell.dataset.index = index;
  cell.innerHTML = '<img class="sprite" alt="" draggable="false"><span class="level"></span>' +
    '<span class="order-mark" aria-hidden="true">单</span><span class="warning-mark" aria-hidden="true">!</span>' +
    '<span class="selection-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
    '<svg class="progress" viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="7" pathLength="100"/></svg>' +
    '<span class="invalid-mark" aria-hidden="true">×</span>';
  board.append(cell);
  return { element: cell, sprite: cell.querySelector('.sprite'), level: cell.querySelector('.level'),
    order: cell.querySelector('.order-mark'), warning: cell.querySelector('.warning-mark'), progress: cell.querySelector('rect') };
});

function say(text) {
  if (feedback === text) return;
  feedback = text; $('feedback').textContent = text;
}
function progress(index = -1, fraction = 0) {
  if (progressIndex >= 0 && progressIndex !== index) {
    cells[progressIndex].element.classList.remove('dwelling');
    cells[progressIndex].progress.style.strokeDashoffset = '100';
  }
  progressIndex = index;
  if (index >= 0) {
    cells[index].element.classList.add('dwelling');
    cells[index].progress.style.strokeDashoffset = String(100 * (1 - fraction));
  }
}
function pulse(index, className = 'merge-pop') {
  if (reducedMotion || index < 0) return;
  const cell = cells[index].element;
  cell.classList.remove(className);
  void cell.offsetWidth;
  cell.classList.add(className);
}
function renderOrders() {
  const order = state.orders[state.focusedOrder];
  $('order-title').textContent = order?.label || '本组订单已完成';
  $('order-count').textContent = order ? `${state.focusedOrder + 1} / ${state.orders.length}` : '已交付';
  $('prev-order').disabled = !order || state.focusedOrder === 0;
  $('next-order').disabled = !order || state.focusedOrder >= state.orders.length - 1;
  $('deliver').disabled = !order || !ready(state, order);
  $('deliver').classList.toggle('ready', !!order && ready(state, order));
  $('order-items').replaceChildren(...(order?.requirements || []).map(requirement => {
    const element = document.createElement('div'), available = count(state, requirement.product, requirement.level) > 0;
    element.className = 'requirement' + (available ? ' ready' : '');
    element.setAttribute('aria-label', description(requirement) + (available ? '，已备好' : '，未备好'));
    const img = document.createElement('img'); img.src = art(requirement); img.alt = productName(requirement.product);
    const level = document.createElement('span'); level.className = 'level'; level.textContent = requirement.level;
    const quantity = document.createElement('span'); quantity.className = 'quantity'; quantity.textContent = available ? '✓ 1/1' : '0/1';
    element.append(img, level, quantity); return element;
  }));
}
function renderDetails() {
  const item = state.board[state.selected];
  $('selected-art').src = art(item);
  $('selected-name').textContent = item ? description(item) : '点选一件商品';
  $('discard').disabled = !item || item.kind !== 'product';
  let hint = '绿色可以合成，金签表示订单需要。';
  if (item?.kind === 'launcher') hint = `库存 ${item.stock} · 点击或长按取货`;
  else if (item) hint = orderMatch(state, item).length ? '订单所需成品 · 可以自由摆位' : item.level === 5 ? '本轮最高等级 · 可移动整理' : '拖到绿色商品，稍停可接着合';
  if (hoverKind === 'protected') hint = '订单需要这件，松手可选择继续';
  else if (hoverKind === 'move') hint = '松手放入空格';
  else if (hoverKind === 'merge') hint = '松手立即合成 · 稍停接着拖';
  else if (hoverKind === 'invalid') hint = '这里不能合成，换一个位置';
  $('item-hint').textContent = hint;
}
function renderBoard() {
  const source = gesture?.dragging ? gesture.source : keyboardSource >= 0 ? keyboardSource : state.selected;
  const sourceKey = state.board[source] ? `${source}/${state.board[source].id}/${state.board[source].level}` : '';
  const freshSelection = sourceKey !== highlightedSource;
  highlightedSource = sourceKey;
  cells.forEach((view, index) => {
    const item = state.board[index], pair = item && index !== source ? previewDrop(state, source, index).kind : '';
    const match = !!item && orderMatch(state, item).length > 0;
    const selected = index === source && !!item;
    view.element.classList.toggle('selected', selected);
    view.element.classList.toggle('source', !!gesture?.dragging && index === source);
    view.element.classList.toggle('safe', pair === 'merge');
    if (freshSelection) {
      view.element.classList.remove('candidate-pulse');
      if (pair === 'merge' && !reducedMotion) {
        void view.element.offsetWidth;
        view.element.classList.add('candidate-pulse');
      }
    }
    view.element.classList.toggle('protected', pair === 'protected');
    view.element.classList.toggle('hover-target', index === hoverIndex && ['merge', 'protected'].includes(hoverKind));
    view.element.classList.toggle('hover-empty', index === hoverIndex && hoverKind === 'move');
    view.element.classList.toggle('hover-invalid', index === hoverIndex && hoverKind === 'invalid');
    view.element.classList.toggle('idle-hint', idlePair.includes(index));
    view.element.dataset.kind = item?.kind || 'empty';
    view.element.dataset.level = item?.level || '';
    view.element.dataset.product = item?.product || '';
    view.element.setAttribute('aria-pressed', String(selected));
    view.element.tabIndex = index === (state.selected >= 0 ? state.selected : 0) ? 0 : -1;
    view.element.setAttribute('aria-label', `第${Math.floor(index / 7) + 1}行第${index % 7 + 1}列，${description(item)}` +
      (match ? '，订单所需' : '') + (pair === 'merge' ? '，可直接合成' : pair === 'protected' ? '，合成需要确认' : ''));
    view.sprite.hidden = !item; view.level.hidden = !item;
    if (item) {
      const src = art(item); if (view.sprite.getAttribute('src') !== src) view.sprite.src = src;
      view.level.textContent = item.kind === 'launcher' ? `${item.stock}` : item.level;
    }
    view.order.hidden = !match; view.warning.hidden = pair !== 'protected';
  });
  $('merge-count').textContent = state.merges;
  $('empty-count').textContent = state.board.filter(item => !item).length;
  renderDetails();
}
function render() { renderBoard(); renderOrders(); }
function clearIdle() {
  clearTimeout(idleTimer); clearTimeout(pulseTimer);
  idlePair = []; cells.forEach(view => view.element.classList.remove('idle-hint'));
}
function scheduleIdle() {
  clearIdle();
  if (state.selected >= 0 || gesture || dialog.open || keyboardSource >= 0 || reducedMotion) return;
  const order = state.orders[state.focusedOrder];
  if (order && ready(state, order)) return;
  idleTimer = setTimeout(() => {
    if (gesture || dialog.open || state.selected >= 0 || document.hidden) return;
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
function afterAction(result) {
  if (!result.ok) { say(reasons[result.reason] || '请换一个有效位置'); return; }
  if (result.kind === 'merge') {
    state.selected = result.to;
    say(`${description(state.board[result.to])}合成完成` + (result.madeOrder ? ' · 订单成品已备好' : ''));
    pulse(result.to);
  } else if (result.kind === 'move') { state.selected = result.to; say('已放入空格'); }
  else if (result.kind === 'launch') { say('取货成功，选中商品寻找可合成对象'); pulse(result.to, 'pulse'); }
  else if (result.kind === 'discard') { say('已丢弃，空出一格'); if (!state.board[state.selected]) state.selected = -1; }
  else if (result.kind === 'deliver') say('交付完成，剩余订单的现货已更新');
  render(); scheduleIdle();
}
function askProtection(action, result) {
  const item = state.board[result.from];
  if (!item) return;
  pending = { action, from: result.from, to: result.to, sourceId: item.id, targetId: state.board[result.to]?.id };
  $('confirm-art').src = art(item); $('confirm-name').textContent = description(item);
  $('protection-message').textContent = `${action === 'discard' ? '丢弃' : '继续合成'}后，将没有可交付的${productName(item.product)}${item.level}级成品。现有订单仍需要它。`;
  $('confirm').textContent = action === 'discard' ? '仍要丢弃' : '仍要合成';
  dialog.returnValue = ''; dialog.showModal(); $('keep').focus();
  clearIdle();
}
function attemptDrop(from, to) {
  const result = drop(state, from, to);
  if (result.kind === 'protected') askProtection('merge', result);
  else if (result.kind !== 'same') afterAction(result);
}
function removeGhost() { ghost?.remove(); ghost = null; }
function finishGesture() {
  demoToken++; $('demo').disabled = false;
  document.body.classList.remove('dragging');
  const previous = gesture; gesture = null;
  if (previous && board.hasPointerCapture(previous.id)) board.releasePointerCapture(previous.id);
  removeGhost(); progress(); hoverIndex = -1; hoverKind = '';
  renderBoard(); return previous;
}
function cancelGesture() { finishGesture(); keyboardSource = -1; renderBoard(); scheduleIdle(); }
function moveGhost() {
  if (!gesture?.dragging) return;
  document.body.classList.add('dragging');
  const item = state.board[gesture.source];
  if (!item) return;
  if (!ghost) {
    ghost = document.createElement('div'); ghost.className = 'drag-ghost'; ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = '<img alt=""><span class="level"></span>'; document.body.append(ghost);
  }
  const size = cells[gesture.source].element.getBoundingClientRect().width;
  ghost.style.width = `${size}px`; ghost.style.height = `${size}px`;
  ghost.style.left = `${gesture.x}px`; ghost.style.top = `${gesture.y - 5}px`;
  ghost.querySelector('img').src = art(item); ghost.querySelector('.level').textContent = item.kind === 'launcher' ? item.stock : item.level;
}
function locateTarget(g) {
  const element = document.elementFromPoint(g.x, g.y)?.closest('.cell');
  const index = element && board.contains(element) ? Number(element.dataset.index) : -1;
  const result = index >= 0 ? previewDrop(state, g.source, index) : null;
  const kind = result?.kind || '';
  if (index !== g.target || kind !== g.targetKind) {
    g.target = index; g.targetKind = kind; g.hoverSince = performance.now(); g.dwellSince = null; progress();
  }
  const bounds = index >= 0 ? cells[index].element.getBoundingClientRect() : null;
  const centered = bounds && Math.abs(g.x - bounds.x - bounds.width / 2) < bounds.width * .29 &&
    Math.abs(g.y - bounds.y - bounds.height / 2) < bounds.height * .29;
  if (kind === 'merge' && centered) {
    if (g.dwellSince === null) g.dwellSince = performance.now();
  } else { g.dwellSince = null; progress(); }
  hoverIndex = index; hoverKind = kind === 'same' ? '' : kind;
  // Do not flash red on every incompatible cell crossed on the way to a target.
  if (hoverKind === 'invalid' && performance.now() - g.hoverSince < 140) hoverKind = '';
}
board.addEventListener('pointerdown', event => {
  if (gesture?.demo) cancelGesture();
  if (gesture || event.isPrimary === false || event.button !== 0 || dialog.open) return;
  const element = event.target.closest('.cell'); if (!element) return;
  event.preventDefault(); clearIdle(); keyboardSource = -1;
  const source = Number(element.dataset.index);
  state.selected = state.board[source] ? source : -1;
  element.focus({ preventScroll: true });
  const now = performance.now();
  gesture = { id: event.pointerId, source, itemId: state.board[source]?.id, startX: event.clientX, startY: event.clientY,
    x: event.clientX, y: event.clientY, started: now, nextShot: now + 400, dragging: false, longPress: false,
    stopped: false, target: -1, targetKind: '', hoverSince: now, dwellSince: null };
  board.setPointerCapture(event.pointerId); renderBoard();
});
board.addEventListener('pointermove', event => {
  const g = gesture; if (!g || event.pointerId !== g.id) return;
  g.x = event.clientX; g.y = event.clientY;
  if (state.board[g.source] && Math.hypot(g.x - g.startX, g.y - g.startY) > 8) g.dragging = true;
  if (g.dragging) { event.preventDefault(); locateTarget(g); moveGhost(); renderBoard(); }
});
board.addEventListener('pointerup', event => {
  if (!gesture || event.pointerId !== gesture.id) return;
  gesture.x = event.clientX; gesture.y = event.clientY;
  if (gesture.dragging) locateTarget(gesture);
  const g = finishGesture();
  if (g.dragging) {
    if (g.target >= 0 && g.source !== g.target) attemptDrop(g.source, g.target);
  } else if (!g.longPress && state.board[g.source]?.kind === 'launcher') afterAction(launch(state, g.source));
  scheduleIdle();
});
board.addEventListener('pointercancel', cancelGesture);
board.addEventListener('lostpointercapture', () => { if (gesture) cancelGesture(); });
window.addEventListener('blur', cancelGesture);
window.addEventListener('resize', cancelGesture);
window.addEventListener('scroll', () => { if (gesture) cancelGesture(); }, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelGesture(); clearIdle(); } else scheduleIdle(); });
board.addEventListener('keydown', event => {
  const element = event.target.closest('.cell'); if (!element) return;
  if (gesture) cancelGesture();
  const index = Number(element.dataset.index), steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (event.key in steps) {
    event.preventDefault(); cells[Math.max(0, Math.min(62, index + steps[event.key]))].element.focus(); return;
  }
  if (event.key === 'Escape') { event.preventDefault(); cancelGesture(); state.selected = -1; renderBoard(); scheduleIdle(); }
  if (event.key === ' ') {
    event.preventDefault(); clearIdle(); state.selected = state.board[index] ? index : -1;
    keyboardSource = state.selected; renderBoard(); say(keyboardSource >= 0 ? '已拿起；方向键选择落点，Enter 放下' : '空格未拿起商品');
  }
  if (event.key === 'Enter') {
    event.preventDefault(); clearIdle();
    if (keyboardSource >= 0) { const source = keyboardSource; keyboardSource = -1; attemptDrop(source, index); renderBoard(); }
    else { state.selected = state.board[index] ? index : -1; if (state.board[index]?.kind === 'launcher') afterAction(launch(state, index)); else renderBoard(); }
  }
});
function frame(now) {
  const g = gesture;
  if (g && !document.hidden && !dialog.open) {
    if (state.board[g.source]?.id !== g.itemId) cancelGesture();
    else if (g.dragging) {
      const previousHover = hoverIndex, previousKind = hoverKind;
      locateTarget(g);
      if (g.dwellSince !== null) {
        const fraction = Math.min(1, (now - g.dwellSince) / dwell);
        progress(g.target, fraction);
        if (fraction >= 1) {
          const result = drop(state, g.source, g.target);
          if (result.ok && result.kind === 'merge') {
            g.source = result.to; g.itemId = state.board[g.source].id;
            g.dwellSince = null; g.targetKind = 'same'; progress(); hoverKind = '';
            afterAction(result); moveGhost();
          } else { g.dwellSince = null; progress(); }
        }
      }
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
  afterAction(action.action === 'merge' ? drop(state, action.from, action.to, true) : discard(state, action.from, true));
});
$('discard').addEventListener('click', () => {
  cancelGesture(); clearIdle(); const result = discard(state, state.selected);
  if (result.kind === 'protected') askProtection('discard', result); else afterAction(result);
});
$('deliver').addEventListener('click', () => {
  cancelGesture(); const order = state.orders[state.focusedOrder]; if (order) afterAction(deliver(state, order.id));
});
for (const [id, offset] of [['prev-order', -1], ['next-order', 1]]) $(id).addEventListener('click', () => {
  cancelGesture(); state.focusedOrder = Math.max(0, Math.min(state.orders.length - 1, state.focusedOrder + offset));
  render(); scheduleIdle();
});
function reset(id = scenario) {
  cancelGesture(); clearIdle(); pending = null; if (dialog.open) dialog.close('cancel');
  scenario = id; state = createScenario(id);
  highlightedSource = '';
  $('scenario-hint').textContent = SCENARIOS.find(entry => entry.id === id).hint;
  document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === id)));
  cells.forEach(view => view.element.classList.remove('pulse', 'merge-pop'));
  say('局面已就绪 · ' + SCENARIOS.find(entry => entry.id === id).title); render(); scheduleIdle();
}
for (const entry of SCENARIOS) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.scenario = entry.id;
  button.textContent = entry.title; button.addEventListener('click', () => reset(entry.id)); $('scenarios').append(button);
}
$('reset').addEventListener('click', () => reset());
$('demo').addEventListener('click', async () => {
  // A visible, replayable gesture example uses the same dwell handling as touch.
  reset(); const token = ++demoToken; $('demo').disabled = true;
  document.querySelector('.phone').scrollIntoView({ block: 'start', behavior: 'instant' });
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (token !== demoToken) return;
  const center = index => {
    const bounds = cells[index].element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  };
  const start = center(16), now = performance.now();
  gesture = { id: -1, source: 16, itemId: state.board[16].id, ...start, startX: start.x, startY: start.y,
    dragging: true, demo: true, target: -1, targetKind: '', hoverSince: now, dwellSince: null };
  say('手势示范中 · 点棋盘或重置可中断'); moveGhost(); renderBoard();
  for (const index of (scenario === 'chain' ? [17, 18, 19] : [17])) {
    if (token !== demoToken) return;
    const origin = { x: gesture.x, y: gesture.y }, target = center(index), started = performance.now();
    await new Promise(resolve => {
      const advance = time => {
        if (token !== demoToken) { resolve(); return; }
        const fraction = Math.min(1, (time - started) / 160);
        gesture.x = origin.x + (target.x - origin.x) * fraction;
        gesture.y = origin.y + (target.y - origin.y) * fraction;
        locateTarget(gesture); moveGhost(); renderBoard();
        if (fraction < 1) requestAnimationFrame(advance); else resolve();
      };
      requestAnimationFrame(advance);
    });
    await new Promise(resolve => {
      const started = performance.now();
      const settle = time => {
        if (token !== demoToken || gesture.source === index ||
            (gesture.targetKind === 'protected' && time - started >= dwell + 240)) { resolve(); return; }
        if (time - started > 2000) { resolve(); return; }
        requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
    });
    if (token !== demoToken) return;
    if (gesture.targetKind === 'protected') break;
  }
  if (token !== demoToken) return;
  const ended = finishGesture();
  if (ended.targetKind === 'protected') attemptDrop(ended.source, ended.target);
  render();
});
$('dwell').addEventListener('input', event => { cancelGesture(); dwell = Number(event.target.value); $('dwell-value').textContent = `${dwell} ms`; });
$('reduced-motion').checked = reducedMotion;
document.body.classList.toggle('reduced-motion', reducedMotion);
$('reduced-motion').addEventListener('change', event => {
  reducedMotion = event.target.checked; document.body.classList.toggle('reduced-motion', reducedMotion); scheduleIdle();
});
document.querySelectorAll('[data-width]').forEach(button => button.addEventListener('click', () => {
  cancelGesture(); document.querySelector('.phone').style.setProperty('--phone-width', button.dataset.width + 'px');
  document.querySelectorAll('[data-width]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
}));
reset(); requestAnimationFrame(frame);
