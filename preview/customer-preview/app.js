import { customers, createDemoState } from './customer-data.js';
import { renderCard, renderProfile, renderRecords, renderBubble } from './customer-components.js';

const state = { ...createDemoState(), selectedId: 'rabbit-courier' };
const header = document.querySelector('#page-header');
const content = document.querySelector('#page-content');
const choice = document.querySelector('#customer-choice');
const status = document.querySelector('#preview-status');
const stateChoice = document.querySelector('#state-choice');
const viewNames = { collection: '顾客图鉴', profile: '街坊档案', records: '关系记录', dialogue: '对白气泡' };
let view = 'collection';
let bubbleKind = 'daily';
let bubbleVisible = true;
let collectionScroll = 0;
let statePreset = 'default';
const readPresets = new Set();

for (const customer of customers) {
  const option = document.createElement('option');
  option.value = customer.id; option.textContent = customer.name; choice.append(option);
}
const current = () => customers.find(customer => customer.id === state.selectedId);
function displayState() {
  if (statePreset === 'default') return state;
  const customer = current();
  const count = { new: 0, ordinary: 0, collected: 1, daily: 12, growing: 14, imminent: 15, max: 16, locked: 0 }[statePreset];
  const services = { new: 0, ordinary: 20, collected: 4, daily: 32, growing: 38, imminent: 42, max: 45, locked: 0 }[statePreset];
  const paid = Object.fromEntries([1,3,6,10,16].flatMap((threshold,index) => count >= threshold ? [[index + 1,[20,40,60,90,120][index]]] : []));
  const unreadKind = { collected: 'collected', daily: 'daily' }[statePreset];
  const showUnread = unreadKind && !readPresets.has(`${customer.id}:${statePreset}`);
  return { ...state, openedGeneration: statePreset === 'locked' ? customer.generation - 1 : Math.max(state.openedGeneration,customer.generation),
    serviceCounts: { ...state.serviceCounts,[customer.id]: services },
    superOrderCounts: { ...state.superOrderCounts,[customer.id]: count },
    superOrderPreviewCustomerId: ['ordinary','locked','max'].includes(statePreset) ? null : customer.id,
    visiting: statePreset === 'locked' ? state.visiting.filter(id=>id!==customer.id) : [...new Set([...state.visiting,customer.id])],
    unread: [...state.unread.filter(id => id !== customer.id), ...(showUnread ? [customer.id] : [])],
    unreadKinds: { ...state.unreadKinds, [customer.id]: showUnread ? unreadKind : null },
    paidGifts: { ...state.paidGifts,[customer.id]: paid } };
}
function readCurrent() {
  if (statePreset !== 'default') {
    readPresets.add(`${state.selectedId}:${statePreset}`);
    return;
  }
  state.unread = state.unread.filter(id => id !== state.selectedId);
  delete state.unreadKinds[state.selectedId];
}
function render() {
  const customer = current();
  const snapshot = displayState();
  choice.value = customer.id;
  document.title = `${viewNames[view]} · 爆米花工坊`;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.view === view));
  header.classList.toggle('has-back', view !== 'collection');
  const back = view !== 'collection' ? '<button type="button" class="back-button" data-action="back" aria-label="返回">‹</button>' : '';
  const title = view === 'profile' ? customer.name : viewNames[view];
  header.innerHTML = `${back}<div class="page-kicker">爆米花工坊 · 街坊日记</div><div class="page-heading"><h1 tabindex="-1">${title}</h1></div>`;
  if (view === 'collection') {
    const collected = customers.filter(item => item.generation <= snapshot.openedGeneration && snapshot.serviceCounts[item.id] > 0).length;
    header.insertAdjacentHTML('beforeend', `<div class="collection-count">已结识 <strong>${collected}<span> / 12</span></strong></div>`);
    content.innerHTML = `<div class="collection-grid">${customers.map(item => renderCard(item, snapshot)).join('')}</div><p class="collection-footer">新的口味，会带来新的街坊。</p>`;
  } else if (view === 'profile') {
    content.innerHTML = renderProfile(customer, snapshot);
  } else if (view === 'records') {
    header.insertAdjacentHTML('beforeend', `<p class="page-subtitle">${customer.name} · 一次次相遇，慢慢熟悉</p>`);
    content.innerHTML = renderRecords(customer, snapshot);
  } else {
    header.insertAdjacentHTML('beforeend', `<p class="page-subtitle">${customer.name}的日常小事</p>`);
    const kinds = [['daily','日常分享'],['ordinary','普通交单'],['milestone','超级订单升星']];
    content.innerHTML = `<div class="dialogue-toolbar" aria-label="对白类型">${kinds.map(([id,label]) => `<button type="button" data-kind="${id}" aria-pressed="${bubbleKind === id}">${label}</button>`).join('')}</div><div class="dialogue-stage">${bubbleVisible ? renderBubble(customer, snapshot, bubbleKind) : '<p class="c-empty">对白已收起</p><button type="button" class="c-button is-secondary dialogue-replay" data-action="replay">再听一遍</button>'}</div>`;
  }
}
function navigate(next, { restore = false, focus = true } = {}) {
  if (view === 'collection' && next !== 'collection') collectionScroll = window.scrollY;
  view = next;
  if (view === 'profile') readCurrent();
  bubbleVisible = true;
  render();
  requestAnimationFrame(() => {
    if (restore && view === 'collection') {
      window.scrollTo({ top: collectionScroll, behavior: 'instant' });
      content.querySelector(`[data-customer="${state.selectedId}"]`)?.focus({ preventScroll: true });
    } else {
      if (focus) header.querySelector('h1')?.focus({ preventScroll: true });
      const appTop = document.querySelector('.customer-app').offsetTop;
      window.scrollTo({ top: window.innerWidth <= 700 ? appTop : 0, behavior: 'instant' });
    }
  });
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.customer) {
    state.selectedId = button.dataset.customer;
    status.textContent = `正在查看${current().name}的档案。`;
    navigate('profile');
  } else if (button.dataset.view) {
    navigate(button.dataset.view, { restore: button.dataset.view === 'collection' });
  } else if (button.dataset.kind) {
    bubbleKind = button.dataset.kind; bubbleVisible = true; render();
    content.querySelector(`[data-kind="${bubbleKind}"]`)?.focus({ preventScroll: true });
  } else if (button.dataset.action === 'back') {
    navigate(view === 'profile' ? 'collection' : 'profile', { restore: view === 'profile' });
  } else if (button.dataset.action === 'records') {
    navigate('records');
  } else if (button.dataset.action === 'speak') {
    bubbleKind = button.dataset.dialogueKind || 'ordinary';
    navigate('dialogue');
  } else if (button.dataset.action === 'dismiss-bubble') {
    bubbleVisible = false; render();
    content.querySelector('[data-action="replay"]')?.focus({ preventScroll: true });
  } else if (button.dataset.action === 'replay') {
    bubbleVisible = true; render();
    content.querySelector('[data-action="dismiss-bubble"]')?.focus({ preventScroll: true });
  } else if (button.dataset.action === 'orders' && button.dataset.orderType === 'ordinary') {
    const detail = { customerId: state.selectedId, orderType: 'ordinary' };
    content.dispatchEvent(new CustomEvent('customer-order-request', { bubbles: true, detail }));
    status.textContent = `普通订单入口已触发：${current().name}。此预览只演示布局，正式订单由小游戏接入。`;
    status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});
choice.addEventListener('change', () => {
  state.selectedId = choice.value;
  status.textContent = `正在预览${current().name}。`;
  if (view === 'profile') readCurrent();
  bubbleVisible = true; render();
});
stateChoice.addEventListener('change', () => {
  statePreset = stateChoice.value;
  readPresets.delete(`${state.selectedId}:${statePreset}`);
  if (view === 'profile') readCurrent();
  status.textContent = `状态示例：${stateChoice.selectedOptions[0].textContent}。`;
  bubbleVisible = true; render();
});
render();
