import { getProgress, relationshipLabels } from './customer-data.js';
import { starsMarkup, progressTrackMarkup, statusTagsMarkup, growthForecastMarkup } from './customer-status.js';

const assetRoot = '/assets';
const products = ['', '原味', '焦糖', '爆米花球', '脆棒', '薄脆', '夹心脆方'];
const starNames = ['零', '一', '二', '三', '四', '五'];

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function countFor(customer, state, key = 'superOrderCounts') {
  const count = Number(state[key]?.[customer.id]);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function isCollected(customer, state) {
  return countFor(customer, state, 'serviceCounts') > 0 || countFor(customer, state) > 0;
}

function relationshipLabel(customer, state, progress) {
  return progress.stars ? progress.label : isCollected(customer, state) ? '已结识·零星' : '新面孔·未收录';
}

function isOpen(customer, state) {
  return customer.generation <= Number(state.openedGeneration || 0);
}

function isVisiting(customer, state) {
  return isOpen(customer, state) && (state.visiting || []).includes(customer.id);
}

function openingCondition(customer) {
  return `首次产出${products[customer.generation] || customer.primary}并正式入库后可来访`;
}

function imagePath(customer, kind) {
  const id = encodeURIComponent(customer.id);
  if (kind === 'silhouette') return `${assetRoot}/source/ui/customer-status/v1/silhouettes/${id}.png`;
  if (kind === 'detail') return `${assetRoot}/source/characters/customer-details/v1/${id}.png`;
  return `${assetRoot}/source/characters/customers/v2/${id}.png`;
}

function nextTarget(progress) {
  if (!progress.stars) return '完成首张超级订单达到一星';
  if (progress.stars === 5) return '熟悉的街坊，随时聊两句';
  return `还差${progress.remaining}张超级订单，${progress.nextStar === 5 ? '成为老朋友' : `达到${starNames[progress.nextStar]}星`}`;
}

function unreadKindFor(customer, state) {
  if (!isOpen(customer, state) || !(state.unread || []).includes(customer.id)) return null;
  const superOrders = countFor(customer, state);
  const kind = state.unreadKinds?.[customer.id];
  if (kind === 'daily' && knownDaily(customer, superOrders)) return 'daily';
  if (kind === 'collected' && isCollected(customer, state)) return 'collected';
  return null;
}

function tagsMarkup(customer, state) {
  return statusTagsMarkup({ visiting: isVisiting(customer, state), unreadKind: unreadKindFor(customer, state) });
}

function knownDaily(customer, superOrders) {
  return (customer.daily || []).filter(entry => entry.superOrders <= superOrders).at(-1);
}

function knownStage(customer, superOrders) {
  return (customer.stages || []).filter(entry => entry.superOrders <= superOrders).at(-1);
}

function preferencesMarkup(customer, state) {
  const preferences = [customer.primary, customer.secondary].filter((product, index, list) =>
    product && list.indexOf(product) === index && products.indexOf(product) <= Number(state.openedGeneration));
  return `<div class="c-preferences" aria-label="已投产的口味偏好">${preferences.map((product, index) =>
    `<span class="c-preference">${index ? '也喜欢' : '偏爱'} ${escape(product)}</span>`).join('')}</div>`;
}

export function renderCard(customer, state) {
  const open = isOpen(customer, state);
  const superOrders = countFor(customer, state);
  const collected = isCollected(customer, state);
  const progress = getProgress(superOrders, state.baseReward);
  const selected = state.selectedId === customer.id;
  const classNames = ['c-card', selected && 'is-selected', !open && 'is-locked', open && !collected && 'is-new', open && progress.stars === 5 && 'is-max'].filter(Boolean).join(' ');
  const status = open ? relationshipLabel(customer, state, progress) : '尚未开放';
  const target = open ? nextTarget(progress) : openingCondition(customer);
  const unreadKind = unreadKindFor(customer, state);
  const accessible = [customer.name,open && collected ? `${starNames[progress.stars]}星` : '',status,target,
    isVisiting(customer,state) ? '正在来访' : '',unreadKind === 'daily' ? '新日常' : unreadKind === 'collected' ? '新结识' : ''].filter(Boolean).join('，');
  return `<button type="button" class="${classNames}" data-customer="${escape(customer.id)}" aria-pressed="${selected}" aria-label="${escape(accessible)}">
    <span class="c-portrait" aria-hidden="true">
      <img class="c-portrait-frame" src="${assetRoot}/runtime/customer-status/v1/selection/portrait-${selected ? 'selected' : 'unselected'}.png" alt="" width="512" height="512">
      <img class="c-portrait-image" src="${escape(imagePath(customer, open ? 'portrait' : 'silhouette'))}" alt="" width="1254" height="1254" loading="lazy">
    </span>
    <span class="c-card-body">
      <span class="c-name">${escape(customer.name)}</span>
      ${open && collected ? starsMarkup(progress.stars) : ''}
      <span class="c-relationship">${escape(status)}</span>
      ${!open ? `<span class="c-identity">${escape(customer.identity)}</span>` : ''}
      <span class="c-target">${escape(target)}</span>
      ${tagsMarkup(customer, state)}
    </span>
  </button>`;
}

function detailHero(customer, state, open, progress) {
  const selected = state.selectedId === customer.id;
  return `<div class="c-profile-hero">
    <div class="c-detail-art${open ? '' : ' is-locked'}">
      <img class="c-detail-frame" src="${assetRoot}/runtime/customer-status/v1/selection/detail-${selected ? 'selected' : 'unselected'}.png" alt="" width="768" height="960">
      <img class="c-detail-image" src="${escape(imagePath(customer, open ? 'detail' : 'silhouette'))}" alt="${escape(open ? `${customer.name}的半身形象` : `${customer.name}的剪影`)}" width="${open ? 1122 : 1254}" height="${open ? 1402 : 1254}">
    </div>
    <div class="c-profile-intro">
      <p class="c-eyebrow">${open ? '街坊档案' : '等待相遇'}</p>
      <h2 class="c-profile-name" id="c-profile-title">${escape(customer.name)}</h2>
      <p class="c-identity">${escape(customer.identity)}</p>
      ${open ? preferencesMarkup(customer, state) : ''}
      ${open && isCollected(customer, state) ? `<div class="c-relationship">${starsMarkup(progress.stars, { next: true })}<span>${escape(relationshipLabel(customer, state, progress))}</span></div>` : `<p class="c-relationship">${open ? '新面孔·未收录' : '尚未开放'}</p>`}
      ${tagsMarkup(customer, state)}
    </div>
  </div>`;
}

function progressMarkup(superOrders, services, progress) {
  if (progress.stars === 5) {
    return `<section class="c-progress is-max" aria-label="关系成长进度"><h3 class="c-progress-title">五星 · 老朋友</h3><p class="c-muted">来店买点吃的，也能自在地聊两句。</p><div class="c-progress-meta"><span>超级订单 <strong>${superOrders}</strong> 张</span><span>累计服务 <strong>${services}</strong> 次</span></div></section>`;
  }
  const target = progress.stars ? `再完成${progress.remaining}张超级订单，${progress.nextStar === 5 ? '成为老朋友' : `达到${starNames[progress.nextStar]}星`}` : '完成首张超级订单，达到一星';
  return `<section class="c-progress" aria-label="关系成长进度">
    <h3 class="c-progress-title">${escape(target)}</h3>
    ${progressTrackMarkup(progress)}
    <div class="c-progress-meta"><span>本阶段 <strong>${progress.current} / ${progress.goal}</strong> 张</span><span>超级订单累计 <strong>${superOrders}</strong> 张</span></div>
    <p class="c-muted">累计服务 ${services} 次 · 普通订单不推进升星</p>
  </section>`;
}

function rewardMarkup(progress) {
  if (progress.stars === 5) {
    return '<div class="c-reward is-complete"><span class="c-reward-icon" aria-hidden="true">✓</span><div class="c-reward-copy"><strong>关系成长已完成</strong><span>过往星级礼金可在关系记录中查阅</span></div></div>';
  }
  return `<div class="c-reward"><span class="c-reward-icon" aria-hidden="true">✦</span><div class="c-reward-copy"><strong>${escape(starNames[progress.nextStar])}星礼 · ${progress.nextGift} 金币</strong><span>超级订单达到${starNames[progress.nextStar]}星时到账</span></div><span class="c-tag">下一星</span></div>`;
}

export function renderProfile(customer, state) {
  const open = isOpen(customer, state);
  const services = countFor(customer, state, 'serviceCounts');
  const superOrders = countFor(customer, state);
  const collected = isCollected(customer, state);
  const progress = getProgress(superOrders, state.baseReward);
  const hero = detailHero(customer, state, open, progress);
  if (!open) {
    return `<article class="c-profile is-locked" aria-labelledby="c-profile-title">${hero}<section class="c-empty"><h3>新的街坊，会随着新品来到这里</h3><p>${escape(openingCondition(customer))}</p><p class="c-muted">开放后来访，完成订单即可结识；首张超级订单点亮一星。</p></section></article>`;
  }
  const daily = knownDaily(customer, superOrders);
  const stage = knownStage(customer, superOrders);
  const visiting = isVisiting(customer, state);
  const superOrder = state.superOrderPreviewCustomerId === customer.id;
  const imminent = superOrder && progress.stars < 5 && progress.remaining === 1;
  const latestIsDaily = daily && (!stage || daily.superOrders > stage.superOrders);
  const newDaily = latestIsDaily && unreadKindFor(customer, state) === 'daily';
  const latestKind = latestIsDaily ? 'daily' : stage ? 'milestone' : 'ordinary';
  const latest = latestIsDaily ? `<p class="c-eyebrow">第${daily.superOrders}张超级订单 · 日常</p><blockquote class="c-quote">${escape(daily.text)}</blockquote>`
    : stage ? `<p class="c-eyebrow">${escape(starNames[stage.stars])}星 · ${escape(stage.detail)}</p><blockquote class="c-quote">${escape(stage.dialogue)}</blockquote>`
      : `<p class="c-empty">${collected ? '已经结识这位街坊。' : ''}完成首张超级订单后，一星关系记录会保存在这里。</p>`;
  return `<article class="c-profile" aria-labelledby="c-profile-title">
    ${hero}
    ${progressMarkup(superOrders, services, progress)}
    ${imminent ? '' : rewardMarkup(progress)}
    ${growthForecastMarkup(progress, { visiting, superOrder })}
    <div class="c-actions">
      ${progress.stars < 5 ? '<button class="c-button is-secondary" type="button" disabled aria-describedby="c-super-order-unavailable">超级订单尚未开放</button><p class="c-availability" id="c-super-order-unavailable">内容待配置</p>' : ''}
      ${visiting ? '<button class="c-button" type="button" data-action="orders" data-order-type="ordinary">查看普通订单 <span aria-hidden="true">→</span></button>' : '<p class="c-availability">下次来访可继续普通服务</p>'}
    </div>
    <section class="c-latest${newDaily ? ' is-unread' : ''}" aria-labelledby="c-latest-title">
      <div class="c-section-heading"><h3 id="c-latest-title">${latestIsDaily ? '最近认识的日常' : stage ? '最近认识的一面' : '初次相遇'}</h3>${collected ? `<button class="c-button is-secondary" type="button" data-action="speak" data-dialogue-kind="${latestKind}">听他说</button>` : ''}</div>
      ${newDaily ? statusTagsMarkup({ unreadKind: 'daily' }) : ''}
      ${latest}
      <button class="c-button is-secondary" type="button" data-action="records">查看关系记录 <span aria-hidden="true">↗</span></button>
    </section>
  </article>`;
}

export function renderRecords(customer, state) {
  if (!isOpen(customer, state)) {
    return '<section class="c-records"><div class="c-empty"><h3>关系记录尚未开启</h3><p>完成首张超级订单后，一星相处片段会保存在这里。</p></div></section>';
  }
  const superOrders = countFor(customer, state);
  const entries = [
    ...customer.stages.map(stage => ({ ...stage, kind: 'milestone', title: `${starNames[stage.stars]}星 · ${relationshipLabels[stage.stars - 1]}` })),
    ...(customer.daily || []).map(daily => ({ ...daily, kind: 'daily', title: '日常小记' })),
  ].sort((left, right) => left.superOrders - right.superOrders);
  const completed = entries.filter(entry => entry.superOrders <= superOrders);
  const latestSuperOrders = completed.at(-1)?.superOrders;
  const unreadDailySuperOrders = unreadKindFor(customer, state) === 'daily' ? knownDaily(customer, superOrders)?.superOrders : null;
  const records = entries.map(entry => {
    const occurred = entry.superOrders <= superOrders;
    const daily = entry.kind === 'daily';
    const newDaily = occurred && daily && entry.superOrders === unreadDailySuperOrders;
    const marker = `<span class="c-record-marker" aria-hidden="true">${occurred ? daily ? '•' : '★' : '○'}</span>`;
    const heading = `<span class="c-record-heading">${escape(entry.title)}${newDaily ? statusTagsMarkup({ unreadKind: 'daily' }) : ''}</span><span class="c-record-condition">累计完成${entry.superOrders}张超级订单${occurred ? ' · 已收录' : ` · 还差${Math.max(0, entry.superOrders - superOrders)}张`}</span>`;
    if (!occurred) {
      return `<div class="c-record is-pending${daily ? ' is-daily' : ''}">${marker}<div class="c-record-summary">${heading}</div></div>`;
    }
    const paid = state.paidGifts?.[customer.id]?.[entry.stars];
    const hasPaid = !daily && Object.prototype.hasOwnProperty.call(state.paidGifts?.[customer.id] || {}, entry.stars) && Number.isFinite(Number(paid)) && Number(paid) >= 0;
    return `<details class="c-record is-complete${daily ? ' is-daily' : ''}${newDaily ? ' is-unread' : ''}"${entry.superOrders === latestSuperOrders ? ' open' : ''}>
      <summary>${marker}<span class="c-record-summary">${heading}</span><span class="c-record-chevron" aria-hidden="true">⌄</span></summary>
      <div class="c-record-body">${daily ? '' : `<p class="c-muted">${escape(entry.detail)}</p>`}<blockquote class="c-quote">${escape(daily ? entry.text : entry.dialogue)}</blockquote>${hasPaid ? `<p class="c-paid">${escape(starNames[entry.stars])}星礼 · <strong>${escape(Number(paid))} 金币</strong><span>已到账</span></p>` : ''}</div>
    </details>`;
  }).join('');
  return `<section class="c-records" aria-label="${escape(customer.name)}的关系记录"><div class="c-section-heading"><h2>相处片段</h2><span class="c-muted">已收录 ${completed.length} / ${entries.length}</span></div><div class="c-timeline">${records}</div></section>`;
}

export function renderBubble(customer, state, kind = 'daily') {
  const open = isOpen(customer, state);
  const superOrders = countFor(customer, state);
  const collected = isCollected(customer, state);
  const stage = open ? knownStage(customer, superOrders) : null;
  const daily = open ? knownDaily(customer, superOrders) : null;
  const mode = ['daily', 'ordinary', 'milestone'].includes(kind) ? kind : 'daily';
  const labels = { daily: '日常对白', ordinary: '普通交单 · 不推进升星', milestone: stage?.stars === 1 ? '超级订单 · 一星相遇' : '超级订单 · 升星相遇' };
  const ordinary = open && collected ? stage?.reply || customer.stages[0]?.reply : null;
  const text = mode === 'daily' ? daily?.text : mode === 'ordinary' ? ordinary : stage?.dialogue;
  const empty = !open ? '这位街坊尚未开放，结识后可以听他说说话。' : mode === 'ordinary' ? '完成订单后，就能听到交单回应。' : mode === 'milestone' ? '完成首张超级订单后，收录一星对白。' : '尚未收录日常对白；下一段日常将在完成第12张超级订单时开启。';
  return `<section class="c-dialogue${text ? '' : ' is-empty'}" aria-label="${escape(customer.name)}的对白" aria-live="polite">
    <img class="c-dialogue-avatar" src="${escape(imagePath(customer, open ? 'portrait' : 'silhouette'))}" alt="" width="1254" height="1254">
    <div class="c-dialogue-content"><div class="c-dialogue-meta"><strong>${escape(customer.name)}</strong><span class="c-tag">${escape(labels[mode])}</span></div>${text ? `<blockquote class="c-bubble">${escape(text)}</blockquote>` : `<p class="c-empty">${escape(empty)}</p>`}</div>
    <button class="c-bubble-close" type="button" data-action="dismiss-bubble" aria-label="关闭对白"><span aria-hidden="true">×</span></button>
  </section>`;
}
