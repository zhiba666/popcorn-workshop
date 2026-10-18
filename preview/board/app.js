import { loadBoardResources } from './resources.js';
import { assetCatalog } from '../../assets/catalog.js';

const initialStocks = { original: 8, caramel: 6, 'popcorn-ball': 12, 'crisp-stick': 9, wafer: 15, 'sandwich-square': 7 };
const types = [...assetCatalog.products]
  .sort((a,b)=>a.index-b.index)
  .map(({id,name})=>({slug:id,name,stock:initialStocks[id]}));
const initialPositions = [8, 12, 29, 33, 50, 54];
const productExamples = [
  [3, 0, 5], [5, 1, 2], [16, 0, 1], [17, 0, 1], [18, 1, 3],
  [21, 2, 2], [24, 3, 1], [26, 3, 3], [38, 4, 2],
  [40, 5, 3], [44, 2, 1], [46, 4, 4], [59, 5, 2],
];
const $ = id => document.getElementById(id);
const board = $('board');
const status = $('status');
const cells = [];
let resources;
let positions = [...initialPositions];
let level = 1;
let selected = 0;
let selection = { kind: 'launcher', type: 0, cell: initialPositions[0] };
let showProducts = true;
let gesture = null;
let renderVersion = 0;
let suppressClick = null;

function productAt(index) {
  return showProducts ? productExamples.find(([cell]) => cell === index) : undefined;
}
function selectionEntry() {
  const product = selection.kind === 'product' && productAt(selection.cell);
  return product ? resources.product(product[1], product[2]) : resources.launcher(selected, level);
}
function showFailure(error) {
  status.textContent = '资源加载失败：' + error.message;
  document.documentElement.dataset.ready = 'error';
}
function setImage(id, entry) {
  const img = $(id);
  img.src = entry.url;
}
function putSprite(container, entry, alt, version) {
  const img = document.createElement('img');
  img.alt = alt;
  img.draggable = false;
  container.replaceChildren(img);
  resources.getImage(entry).then(() => {
    if (version !== renderVersion || !container.isConnected) return;
    img.src = entry.url;
  }).catch(showFailure);
}
function skin(container, key) {
  return resources.applySkin(container, resources.ui(key)).ready;
}
function renderOrders() {
  for (const [type, prefix] of [[0, 'original'], [1, 'caramel']]) {
    const ready = showProducts && productExamples.some(([, productType, productLevel]) => productType === type && productLevel === 5);
    $(prefix + '-progress').textContent = ready ? '1/1' : '0/1';
    $(prefix + '-ready').hidden = !ready;
  }
}
function renderDetails(version = renderVersion) {
  const product = selection.kind === 'product' && productAt(selection.cell);
  const itemType = product ? product[1] : selected;
  const itemLevel = product ? product[2] : level;
  const name = types[itemType].name;
  $('selected-name').textContent = name + (product ? '商品' : '发射器');
  $('selected-level').textContent = itemLevel + '级';
  $('board-caption').textContent = '六种发射器 · ' + level + '级';
  $('item-name').textContent = product ? name + ' · Lv.' + itemLevel : name + ' · 1号线';
  $('item-description').textContent = product ? '同种同级可合成' : '出厂 Lv.' + level + ' · 库存 ' + types[itemType].stock;
  $('item-details').setAttribute('aria-label', '查看' + name + (product ? '商品' : '发射器') + '详情');
  $('discard-button').hidden = !product;
  document.querySelectorAll('[data-level]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.level) === level)));
  document.querySelectorAll('[data-type]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.type) === selected)));
  const entry = selectionEntry();
  setImage('item-image', entry);
  putSprite($('detail-sprite'), entry, name + ' · ' + itemLevel + '级', version);
}
function renderBoard() {
  const version = ++renderVersion;
  const pairCounts = new Map();
  if (showProducts) productExamples.forEach(([, type, grade]) => {
    const key = type + '-' + grade;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  });
  cells.forEach((cell, index) => {
    cell.querySelectorAll(':scope > :not(.skin-canvas)').forEach(child => child.remove());
    cell.className = 'cell';
    const launcherType = positions.indexOf(index);
    const product = productAt(index);
    cell.removeAttribute('aria-pressed');
    if (launcherType === -1 && !product) {
      cell.setAttribute('aria-label', '空格，第' + (Math.floor(index / 7) + 1) + '行第' + (index % 7 + 1) + '列');
      cell.title = '点击移入所选发射器';
      return;
    }
    const isLauncher = launcherType !== -1;
    const itemType = isLauncher ? launcherType : product[1];
    const itemLevel = isLauncher ? level : product[2];
    const name = types[itemType].name + (isLauncher ? '发射器' : '商品') + ' · ' + itemLevel + '级';
    const isSelected = selection.kind === (isLauncher ? 'launcher' : 'product') && selection.cell === index;
    cell.classList.add(isLauncher ? 'launcher' : 'product');
    cell.classList.toggle('selected', isSelected);
    cell.setAttribute('aria-pressed', String(isSelected));
    cell.setAttribute('aria-label', name + '，第' + (Math.floor(index / 7) + 1) + '行第' + (index % 7 + 1) + '列');
    cell.title = name;
    let stateId = null;
    if (isSelected) stateId = 'cell-selected';
    else if (!isLauncher && itemLevel === 5 && itemType < 2) stateId = 'cell-order-match';
    else if (!isLauncher && (pairCounts.get(itemType + '-' + itemLevel) || 0) > 1) stateId = 'cell-mergeable';
    if (stateId) {
      const state = document.createElement('img');
      state.className = 'cell-state';
      state.src = resources.state(stateId).url;
      state.alt = '';
      state.draggable = false;
      cell.append(state);
    }
    const sprite = document.createElement('div');
    sprite.className = 'sprite';
    const label = document.createElement('span');
    label.className = 'item-label';
    if (isLauncher) {
      const line = document.createElement('span');
      line.className = 'line-label';
      line.textContent = '1号';
      const stock = document.createElement('span');
      stock.className = 'stock-label';
      stock.textContent = String(types[itemType].stock);
      label.append(line, stock);
    } else {
      const grade = document.createElement('span');
      grade.className = 'level-label';
      grade.textContent = String(itemLevel);
      label.append(grade);
    }
    cell.append(sprite, label);
    putSprite(sprite, isLauncher ? resources.launcher(itemType, itemLevel) : resources.product(itemType, itemLevel), name, version);
  });
  renderDetails(version);
  renderOrders();
}
function selectType(type) {
  selected = type;
  selection = { kind: 'launcher', type, cell: positions[type] };
  renderBoard();
}
function moveLauncher(type, target) {
  if (target < 0 || positions.includes(target) || productAt(target)) return false;
  positions[type] = target;
  selected = type;
  selection = { kind: 'launcher', type, cell: target };
  status.textContent = types[type].name + '发射器已移到第' + (Math.floor(target / 7) + 1) + '行、第' + (target % 7 + 1) + '列';
  renderBoard();
  return true;
}
function endGesture(event) {
  if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.id)) return;
  const ended = gesture;
  gesture = null;
  ended.ghost?.remove();
  ended.cell.classList.remove('drag-origin');
  cells.forEach(cell => cell.classList.remove('drop-target'));
  document.body.classList.remove('dragging');
  if (ended.cell.hasPointerCapture(ended.id)) ended.cell.releasePointerCapture(ended.id);
  if (ended.dragging) {
    suppressClick = ended.source;
    if (event.type === 'pointerup') {
      if (ended.target >= 0) moveLauncher(ended.type, ended.target);
      else status.textContent = '请将发射器放入空格，当前摆位保持不变。';
    }
  }
}
async function init() {
  resources = await loadBoardResources();
  const uiEntries = Object.keys(resources.manifest.ui).map(key => resources.ui(key));
  const icons = Object.keys(resources.manifest.icons).map(key => resources.icon(key));
  const initialSprites = types.map((_, type) => resources.launcher(type, 1));
  const productSprites = productExamples.map(([, type, grade]) => resources.product(type, grade));
  await resources.preload([...uiEntries, ...icons, ...initialSprites, ...productSprites, resources.customer(), resources.product(1, 5), ...['cell-selected', 'cell-mergeable', 'cell-order-match', 'cell-blocked'].map(id => resources.state(id))]);
  const backgrounds = ['background-table', 'background-room'].map(key => {
    const img = document.createElement('img');
    img.className = key === 'background-table' ? 'scene-table-img' : 'scene-room-img';
    img.src = resources.ui(key).url;
    img.alt = '';
    img.draggable = false;
    return img;
  });
  $('board-scene').prepend(...backgrounds);
  await Promise.all([
    skin($('title-skin'), 'title-sign'), skin($('wallet-skin'), 'currency-pill'),
    skin($('order-card'), 'panel-cream'), skin($('order-portrait'), 'portrait-well'),
    skin($('next-card'), 'panel-cream'), skin(board, 'board-frame'),
    skin($('item-info'), 'panel-cream'), skin($('item-portrait'), 'portrait-well'),
    skin($('deliver-button'), 'button-teal'), skin($('item-details'), 'button-teal'),
    skin($('discard-button'), 'button-red'), skin($('factory-tab'), 'nav-idle'),
    skin($('board-tab'), 'nav-active'),
  ]);
  for (const [id, key] of [
    ['title-decoration', 'popcorn'], ['wallet-coin', 'coin'], ['customer-star', 'star'],
    ['reward-coin', 'coin'], ['next-arrow', 'arrow-right'], ['original-ready', 'check'],
    ['caramel-ready', 'check'], ['discard-icon', 'trash'], ['factory-icon', 'factory-idle'],
    ['board-icon', 'board-active'], ['nav-decoration', 'popcorn'],
  ]) setImage(id, resources.icon(key));
  setImage('customer-image', resources.customer());
  setImage('order-original', resources.product(0, 5));
  setImage('order-caramel', resources.product(1, 5));
  for (let index = 0; index < 63; index++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.dataset.cell = index;
    cell.addEventListener('click', event => {
      if (suppressClick !== null) {
        const suppressed = suppressClick;
        suppressClick = null;
        if (index === suppressed) return;
      }
      const type = positions.indexOf(index);
      const product = productAt(index);
      if (type !== -1) selectType(type);
      else if (product) {
        selected = product[1];
        selection = { kind: 'product', type: selected, cell: index };
        renderBoard();
      } else if (selection.kind === 'launcher') moveLauncher(selected, index);
      else status.textContent = '选中发射器后，可点击空格调整摆位。';
    });
    board.append(cell);
    cells.push(cell);
    await skin(cell, 'board-cell');
  }
  for (let spriteLevel = 1; spriteLevel <= 6; spriteLevel++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.level = spriteLevel;
    button.textContent = spriteLevel + '级';
    button.addEventListener('click', () => {
      endGesture({ type: 'cancel' });
      level = spriteLevel;
      status.textContent = '六种发射器已切换为' + level + '级';
      renderBoard();
    });
    $('level-options').append(button);
  }
  types.forEach((type, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.type = index;
    button.textContent = type.name;
    button.addEventListener('click', () => selectType(index));
    $('type-options').append(button);
  });
  board.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture) return;
    const cell = event.target.closest('[data-cell]');
    if (!cell) return;
    const source = Number(cell.dataset.cell);
    const type = positions.indexOf(source);
    if (type === -1) return;
    suppressClick = null;
    gesture = { id: event.pointerId, type, source, cell, x: event.clientX, y: event.clientY, dragging: false, target: -1, ghost: null };
    cell.setPointerCapture(event.pointerId);
  });
  board.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!gesture.dragging && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) {
      gesture.dragging = true;
      gesture.cell.classList.add('drag-origin');
      document.body.classList.add('dragging');
      const source = gesture.cell.querySelector('.sprite');
      if (source) {
        const rect = source.getBoundingClientRect();
        gesture.ghost = source.cloneNode(true);
        gesture.ghost.className = 'drag-ghost';
        gesture.ghost.style.width = rect.width + 'px';
        gesture.ghost.style.height = rect.height + 'px';
        document.body.append(gesture.ghost);
      }
    }
    if (!gesture.dragging) return;
    event.preventDefault();
    if (gesture.ghost) {
      gesture.ghost.style.left = event.clientX + 'px';
      gesture.ghost.style.top = event.clientY + 'px';
    }
    cells.forEach(cell => cell.classList.remove('drop-target'));
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cell]');
    const index = target ? Number(target.dataset.cell) : -1;
    gesture.target = index >= 0 && !positions.includes(index) && !productAt(index) ? index : -1;
    if (gesture.target >= 0) cells[gesture.target].classList.add('drop-target');
  });
  board.addEventListener('pointerup', endGesture);
  board.addEventListener('pointercancel', endGesture);
  board.addEventListener('lostpointercapture', endGesture);
  window.addEventListener('blur', () => endGesture({ type: 'cancel' }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) endGesture({ type: 'cancel' }); });
  $('show-products').addEventListener('change', event => {
    endGesture({ type: 'cancel' });
    showProducts = event.target.checked;
    if (!showProducts && selection.kind === 'product') selection = { kind: 'launcher', type: selected, cell: positions[selected] };
    renderBoard();
  });
  $('show-labels').addEventListener('change', event => board.classList.toggle('labels-hidden', !event.target.checked));
  $('sprite-scale').addEventListener('input', event => {
    document.documentElement.style.setProperty('--sprite-scale', Number(event.target.value) / 100);
    $('scale-value').value = event.target.value + '%';
  });
  $('reset-layout').addEventListener('click', () => {
    endGesture({ type: 'cancel' });
    positions = [...initialPositions];
    selection = { kind: 'launcher', type: selected, cell: positions[selected] };
    status.textContent = '已恢复六种发射器的默认摆位';
    renderBoard();
  });
  $('item-details').addEventListener('click', () => {
    const detail = document.querySelector('.selected-section');
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    detail.classList.add('detail-highlight');
    setTimeout(() => detail.classList.remove('detail-highlight'), 800);
  });
  document.querySelectorAll('.order-requirement').forEach(button => {
    button.addEventListener('click', () => {
      const type = Number(button.dataset.product);
      const product = showProducts && productExamples.find(([, itemType, grade]) => itemType === type && grade === 5);
      if (product) {
        selected = type;
        selection = { kind: 'product', type, cell: product[0] };
        renderBoard();
      } else selectType(type);
    });
  });
  renderBoard();
  document.documentElement.dataset.ready = 'true';
  status.textContent = '棋盘资源已接入。点击查看对象，拖动发射器到空格可调整摆位。';
}
init().catch(showFailure);
window.addEventListener('pagehide', event => {
  endGesture({ type: 'cancel' });
  if (!event.persisted) resources?.dispose();
});

