'use strict';

const { getCustomer, getProgress, relationshipLabels } = require('../../domain/customers/customer-config');

const COLORS = { ink: '#574332', muted: '#716451', teal: '#24665d', paper: '#fff9eb', mint: '#3b958b', gold: '#a96c16' };
const STAR_NAMES = ['零', '一', '二', '三', '四', '五'];
const PRODUCTS = ['', '原味', '焦糖', '爆米花球', '脆棒', '薄脆', '夹心脆方'];
const CONTENT = { x: 19, y: 177, w: 352, h: 592 };
const within = (x, y, rect) => x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;

function font(renderer, size, bold) {
  renderer.ctx.font = `${bold ? 'bold ' : ''}${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
}

function lines(renderer, value, width, size = 13, bold = false) {
  font(renderer, size, bold);
  const output = [];
  String(value || '').split('\n').forEach(paragraph => {
    let line = '';
    Array.from(paragraph).forEach(character => {
      if (line && renderer.ctx.measureText(line + character).width > width) {
        output.push(line); line = character;
      } else line += character;
    });
    output.push(line);
  });
  return output;
}

function paragraph(renderer, value, x, y, width, size = 13, color = COLORS.ink, lineHeight = 21, align = 'left', bold = false) {
  const wrapped = Array.isArray(value) ? value : lines(renderer, value, width, size, bold);
  wrapped.forEach((line, index) => renderer.text(line, x, y + index * lineHeight, size, color, align, bold));
  return wrapped.length * lineHeight;
}

function panel(renderer, id, x, y, w, h, alpha = 1) {
  if (!renderer.slice(`customer-ui/${id}`, x, y, w, h, alpha)) renderer.roundRect(x, y, w, h, 15, COLORS.paper, '#d2bb91');
}

function stars(renderer, count, x, y, size = 19, gap = 4) {
  const ctx = renderer.ctx;
  ctx.save(); ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
  for (let star = 0; star < 5; star++) {
    const cx = x + star * (size + gap) + size / 2, cy = y + size / 2;
    ctx.beginPath();
    for (let point = 0; point < 10; point++) {
      const radius = size * (point % 2 ? 0.22 : 0.47), angle = -Math.PI / 2 + point * Math.PI / 5;
      const px = cx + Math.cos(angle) * radius, py = cy + Math.sin(angle) * radius;
      if (!point) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fillStyle = star < count ? '#edbd53' : '#eee8d9';
    ctx.strokeStyle = star < count ? '#a66f20' : '#998a6e'; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function chip(renderer, text, x, y, width, kind = 'visiting') {
  const unread = kind === 'unread';
  renderer.roundRect(x, y, width, 23, 6, unread ? '#fff0c8' : '#e4f0e4', unread ? '#d3b871' : '#9cbea9');
  renderer.text(text, x + width / 2, y + 11.5, 11, unread ? '#79531f' : '#285f51', 'center', true);
}

function status(renderer, info, center, y) {
  const labels = [];
  if (info.visiting) labels.push({ text: '正在来访', width: 67, kind: 'visiting' });
  if (info.unread) labels.push({ text: info.unreadKind === 'daily' ? '新日常' : info.unreadKind === 'growth' ? '新记录' : '新结识', width: 55, kind: 'unread' });
  let x = center - (labels.reduce((sum, label) => sum + label.width, 0) + Math.max(0, labels.length - 1) * 5) / 2;
  labels.forEach(label => { chip(renderer, label.text, x, y, label.width, label.kind); x += label.width + 5; });
  return labels.length ? 23 : 0;
}

function opening(customer) { return `首次产出${PRODUCTS[customer.generation] || customer.primary}并正式入库后可来访`; }
function relationship(info) {
  if (info.progress.stars) return info.progress.label;
  return info.collected ? '已结识 · 零星' : '新面孔·未收录';
}
function milestoneCount(entry) {
  return Math.max(0, Number(entry.superOrders == null ? entry.services : entry.superOrders) || 0);
}
function target(info) {
  if (!info.eligible) return opening(info.customer);
  if (!info.collected) return '完成首次订单即可结识';
  if (!info.progress.stars) return '完成首张超级订单升一星';
  if (info.progress.stars === 5) return '熟悉的街坊，随时聊两句';
  return `还差${info.progress.remaining}张超级订单，${info.progress.nextStar === 5 ? '成为老朋友' : `达到${STAR_NAMES[info.progress.nextStar]}星`}`;
}

function infoFor(info) {
  const services = Math.max(0, Number(info.services) || 0);
  const superOrdersCompleted = Math.max(0, Number(info.superOrdersCompleted) || 0);
  return { ...info, services, superOrdersCompleted, collected: !!info.collected || services > 0 || superOrdersCompleted > 0,
    progress: info.progress || getProgress(superOrdersCompleted), eligible: !!info.eligible };
}

function addHit(renderer, rect, hit, scrolling = true) {
  const viewport = renderer.customerViewport;
  const transformed = scrolling ? { ...rect, y: rect.y + viewport.y - renderer.customerScroll } : rect;
  const top = Math.max(transformed.y, scrolling ? viewport.y : transformed.y);
  const bottom = Math.min(transformed.y + transformed.h, scrolling ? viewport.y + viewport.h : transformed.y + transformed.h);
  if (bottom > top) renderer.customerHitRegions.push({ ...transformed, y: top, h: bottom - top,
    hit: { ...hit, ...(scrolling ? { customerScrollable: true } : {}) } });
}

function button(renderer, label, rect, secondary = false) {
  renderer.roundRect(rect.x, rect.y, rect.w, rect.h, 11, secondary ? '#fcf7e8' : COLORS.teal, secondary ? '#bac7ab' : '#1c574e');
  renderer.text(label, rect.x + rect.w / 2, rect.y + rect.h / 2, secondary ? 12 : 14, secondary ? COLORS.teal : COLORS.paper, 'center', true);
}

function drawCollection(renderer, collection) {
  renderer.text('顾客图鉴', 23, 142, 20, COLORS.ink, 'left', true);
  const count = collection.filter(info => info.collected || info.services > 0).length;
  renderer.roundRect(238, 127, 130, 31, 15, '#e2ecdb');
  renderer.text(`已结识 ${count} / ${collection.length}`, 303, 142, 13, COLORS.teal, 'center', true);
  renderer.customerScrollMax = Math.max(0, Math.ceil(collection.length / 2) * 306 + 34 - CONTENT.h);
  setCustomerScroll(renderer, renderer.customerScroll);
  const ctx = renderer.ctx;
  ctx.save(); ctx.beginPath(); ctx.rect(CONTENT.x, CONTENT.y, CONTENT.w, CONTENT.h); ctx.clip();
  ctx.translate(0, CONTENT.y - renderer.customerScroll);
  collection.forEach((info, index) => {
    const customer = info.customer, progress = info.progress;
    const x = CONTENT.x + (index % 2) * 181, y = Math.floor(index / 2) * 306, width = 171, height = 294;
    if (y + height < renderer.customerScroll || y > renderer.customerScroll + CONTENT.h) return;
    panel(renderer, 'collection-card', x, y, width, height);
    renderer.contain('customer-selection/portrait-unselected', x + 15, y + 4, 141, 141);
    renderer.contain(`${info.eligible ? 'customer' : 'customer-silhouette'}/${customer.id}`, x + 30.4, y + 19.4, 110.2, 108, info.eligible ? 1 : 0.8);
    if (info.eligible && !info.collected) renderer.contain('customer-badge/new-customer', x + 120, y + 8, 39, 39);
    if (progress.stars === 5) renderer.contain('customer-badge/max-star', x + 120, y + 8, 39, 39);
    renderer.text(customer.name, x + width / 2, y + 155, 15, COLORS.ink, 'center', true);
    if (info.eligible && info.collected) stars(renderer, progress.stars, x + (width - 107) / 2, y + 170, 18, 4.25);
    const label = !info.eligible ? '尚未开放' : relationship(info);
    renderer.roundRect(x + 21, y + 196, 129, 23, 11, '#e4eddb');
    renderer.text(label, x + width / 2, y + 207.5, 12, COLORS.teal, 'center');
    if (!info.eligible) renderer.text(customer.identity, x + width / 2, y + 183, 10, COLORS.muted, 'center');
    paragraph(renderer, target(info), x + width / 2, y + 235, width - 27, 11.5, info.eligible ? COLORS.ink : COLORS.muted, 17, 'center');
    status(renderer, info, x + width / 2, y + 263);
    addHit(renderer, { x, y, w: width, h: height }, { type: 'customer-select', customerId: customer.id });
  });
  renderer.text('新产品投产后，会有新的街坊来到这里', 195, Math.ceil(collection.length / 2) * 306 + 11, 11, COLORS.muted, 'center');
  ctx.restore();
}

function profileLayout(renderer, info, collection) {
  const customer = info.customer, progress = info.progress, width = CONTENT.w;
  const blocks = [], bodyWidth = width - 38;
  let y = 0;
  const add = (kind, height, extra = {}) => { blocks.push({ kind, y, h: height, ...extra }); y += height + 10; };
  const highestGeneration = Math.max(1, ...collection.filter(entry => entry.eligible).map(entry => entry.customer.generation));
  const preferences = [customer.primary, customer.secondary].filter((product, index, all) => product && all.indexOf(product) === index && PRODUCTS.indexOf(product) <= highestGeneration);
  add('hero', info.eligible ? 345 + (info.visiting || info.unread ? 29 : 0) : 296, { preferences });
  if (!info.eligible) {
    const description = lines(renderer, opening(customer), bodyWidth, 13);
    add('locked', 90 + description.length * 21, { description });
    return { blocks, height: y };
  }
  const progressTitle = progress.stars === 5 ? '五星 · 老朋友' : progress.stars ? `再完成${progress.remaining}张超级订单，${progress.nextStar === 5 ? '成为老朋友' : `达到${STAR_NAMES[progress.nextStar]}星`}` : '完成首张超级订单，达到一星';
  const progressTitleLines = lines(renderer, progressTitle, bodyWidth, 15, true);
  add('progress', progress.stars === 5 ? 113 : 127 + Math.max(0, progressTitleLines.length - 1) * 22, { title: progressTitleLines });
  if (progress.stars < 5) add('super-unavailable', 82);
  add('gift', 70);
  add('orders', 44);
  if (progress.stars === 5) {
    const bio = lines(renderer, customer.bio, bodyWidth, 13);
    add('bio', 46 + bio.length * 22, { body: bio });
  }
  const daily = (customer.daily || []).filter(entry => milestoneCount(entry) <= info.superOrdersCompleted).slice(-1)[0];
  const stage = (customer.stages || []).filter(entry => milestoneCount(entry) <= info.superOrdersCompleted).slice(-1)[0];
  const latestText = daily ? daily.text : stage ? stage.dialogue : info.collected ? '已经结识这位街坊。完成超级订单后，会逐步认识更多生活片段。' : '完成首次订单后，即可收录这位街坊。';
  const latest = lines(renderer, latestText, bodyWidth, 13);
  const subtitle = lines(renderer, daily ? `第${milestoneCount(daily)}张超级订单 · 日常` : stage ? `${STAR_NAMES[stage.stars]}星 · ${stage.detail}` : '星级档案随超级订单逐步开放', bodyWidth, 11);
  add('latest', 70 + subtitle.length * 17 + latest.length * 22, { body: latest, subtitle, daily, stage });
  add('records-heading', 36);
  const entries = [...customer.stages.map(entry => ({ ...entry, kind: 'milestone' })), ...(customer.daily || []).map(entry => ({ ...entry, kind: 'daily' }))]
    .sort((left, right) => milestoneCount(left) - milestoneCount(right));
  const newest = entries.filter(entry => milestoneCount(entry) <= info.superOrdersCompleted).slice(-1)[0];
  entries.forEach(entry => {
    const occurred = milestoneCount(entry) <= info.superOrdersCompleted;
    const recordKey = `${customer.id}/${entry.kind}/${milestoneCount(entry)}`;
    const saved = renderer.customerRecordExpanded || {};
    const expanded = occurred && (Object.prototype.hasOwnProperty.call(saved, recordKey) ? saved[recordKey] : entry === newest);
    const body = lines(renderer, entry.kind === 'daily' ? entry.text : entry.dialogue, bodyWidth - 14, 13);
    const detail = entry.kind === 'daily' ? [] : lines(renderer, entry.detail, bodyWidth - 14, 12);
    const paidGift = entry.kind === 'milestone' && Object.prototype.hasOwnProperty.call(info.paidGifts || {}, entry.stars) ? info.paidGifts[entry.stars] : null;
    add('record', expanded ? 81 + body.length * 22 + detail.length * 19 + (paidGift !== null ? 28 : 0) : 71,
      { entry, recordKey, occurred, expanded, body, detail, paidGift });
  });
  return { blocks, height: y + 8 };
}

function drawHero(renderer, info, block) {
  const customer = info.customer, center = 195, y = block.y, progress = info.progress;
  renderer.contain('customer-selection/detail-selected', 123, y, 144, 180);
  renderer.contain(`${info.eligible ? 'customer-detail' : 'customer-silhouette'}/${customer.id}`, 135, y + 12, 120, 154.5, info.eligible ? 1 : 0.8);
  addHit(renderer, { x: 116, y, w: 158, h: 184 }, { type: 'customer-talk', customerId: customer.id });
  renderer.text(info.eligible ? '街坊档案' : '等待相遇', center, y + 192, 11, COLORS.muted, 'center');
  renderer.text(customer.name, center, y + 216, 22, COLORS.ink, 'center', true);
  renderer.text(customer.identity, center, y + 242, 13, COLORS.muted, 'center');
  if (info.eligible) {
    renderer.text(block.preferences.map((product, index) => `${index ? '也喜欢' : '偏爱'} ${product}`).join(' · '), center, y + 266, 12, '#456956', 'center');
    if (info.collected) stars(renderer, progress.stars, center - 65.5, y + 283, 23, 4);
    renderer.text(relationship(info), center, y + (info.collected ? 323 : 302), 13, COLORS.teal, 'center');
    status(renderer, info, center, y + 340);
  } else renderer.text('尚未开放', center, y + 272, 13, COLORS.teal, 'center');
}

function drawProfileBlock(renderer, info, block) {
  const x = CONTENT.x, width = CONTENT.w, y = block.y, inner = x + 19, bodyWidth = width - 38;
  const progress = info.progress, customer = info.customer;
  if (block.kind === 'hero') { drawHero(renderer, info, block); return; }
  if (block.kind === 'locked') {
    panel(renderer, 'profile-sheet', x, y, width, block.h);
    renderer.text('新的街坊，会随着新品来到这里', 195, y + 25, 15, COLORS.teal, 'center', true);
    paragraph(renderer, block.description, 195, y + 56, bodyWidth, 13, COLORS.ink, 21, 'center');
    renderer.text('开放后来访，完成首次订单即可结识。', 195, y + block.h - 23, 12, COLORS.muted, 'center');
  } else if (block.kind === 'progress') {
    panel(renderer, 'profile-sheet', x, y, width, block.h);
    paragraph(renderer, block.title, inner, y + 24, bodyWidth, 15, COLORS.teal, 22, 'left', true);
    if (progress.stars === 5) {
      renderer.text('来店买点吃的，也能自在地聊两句。', inner, y + 48, 12, COLORS.muted);
      renderer.text('超级订单 16 / 16 张，全部完成', inner, y + 72, 12, COLORS.teal);
      renderer.text(`累计服务 ${info.services} 次`, inner, y + 94, 12, COLORS.muted);
    } else {
      const extraHeight = Math.max(0, block.title.length - 1) * 22;
      const track = { x: inner, y: y + 45 + extraHeight, w: bodyWidth, h: 16 };
      renderer.roundRect(track.x, track.y, track.w, track.h, 8, '#e8e6d7', '#a8b39a');
      const ratio = Math.min(1, Math.max(0, progress.current / Math.max(1, progress.goal)));
      if (ratio) renderer.roundRect(track.x + 1, track.y + 1, (track.w - 2) * ratio, track.h - 2, 7, '#378a79');
      const ctx = renderer.ctx;
      ctx.save(); ctx.fillStyle = '#fff9eb';
      for (let i = 1; i < progress.goal; i++) ctx.fillRect(track.x + track.w * i / progress.goal - 1, track.y + 1, 2, track.h - 2);
      ctx.restore();
      renderer.text(`本阶段 ${progress.current} / ${progress.goal} 张`, inner, y + 79 + extraHeight, 12, COLORS.muted);
      renderer.text(`超级订单 ${info.superOrdersCompleted} / 16 张`, x + width - 19, y + 79 + extraHeight, 12, COLORS.muted, 'right');
      renderer.text(`累计服务 ${info.services} 次 · 普通订单不推进升星`, inner, y + 105 + extraHeight, 11, COLORS.muted);
    }
  } else if (block.kind === 'super-unavailable') {
    panel(renderer, 'relationship-entry', x, y, width, block.h);
    renderer.text('超级订单尚未开放', inner, y + 27, 15, COLORS.teal, 'left', true);
    renderer.text('完成超级订单才会推进星级与关系档案。', inner, y + 55, 12, COLORS.muted);
  } else if (block.kind === 'gift') {
    const full = progress.stars === 5;
    renderer.roundRect(x, y, width, block.h, 13, full ? '#edf3e5' : '#fff2d3', full ? '#bdcfad' : '#d5b878');
    if (!full) renderer.contain('icon/coin', inner - 3, y + 16, 35, 35);
    else renderer.text('✓', inner + 13, y + 34, 25, COLORS.teal, 'center', true);
    renderer.text(full ? '关系成长已完成' : `${STAR_NAMES[progress.nextStar]}星礼 · ${progress.nextGift} 金币`, inner + 44, y + 25, 15, full ? COLORS.teal : '#76501f', 'left', true);
    renderer.text(full ? '过往星级礼金可在关系记录中查阅' : `达到${STAR_NAMES[progress.nextStar]}星时，随超级订单到账`, inner + 44, y + 48, 11, COLORS.muted);
  } else if (block.kind === 'orders') {
    const rect = { x, y, w: width, h: block.h };
    if (info.visiting) {
      button(renderer, '查看他的订单  →', rect);
      addHit(renderer, rect, { type: 'customer-orders', customerId: customer.id });
    } else renderer.text('下次来访可继续服务', 195, y + 22, 13, COLORS.muted, 'center');
  } else if (block.kind === 'bio') {
    panel(renderer, 'profile-sheet', x, y, width, block.h);
    renderer.text('关于这位街坊', inner, y + 24, 15, COLORS.ink, 'left', true);
    paragraph(renderer, block.body, inner, y + 52, bodyWidth, 13, COLORS.ink, 22);
  } else if (block.kind === 'latest') {
    panel(renderer, 'profile-sheet', x, y, width, block.h);
    renderer.text(block.daily ? '最近认识的日常' : block.stage ? '最近认识的一面' : info.collected ? '已经结识' : '初次相遇', inner, y + 27, 14, COLORS.ink, 'left', true);
    const talk = { x: x + width - 90, y: y + 7, w: 75, h: 44 };
    button(renderer, '听他说', talk, true);
    addHit(renderer, talk, { type: 'customer-talk', customerId: customer.id });
    paragraph(renderer, block.subtitle, inner, y + 59, bodyWidth, 11, COLORS.muted, 17);
    paragraph(renderer, block.body, inner, y + 68 + block.subtitle.length * 17, bodyWidth, 13, COLORS.ink, 22);
  } else if (block.kind === 'records-heading') {
    renderer.text('相处片段', x + 4, y + 19, 17, COLORS.ink, 'left', true);
    const total = customer.stages.length + (customer.daily || []).length;
    const completed = [...customer.stages, ...(customer.daily || [])].filter(entry => milestoneCount(entry) <= info.superOrdersCompleted).length;
    renderer.text(`已收录 ${completed} / ${total}`, x + width - 4, y + 19, 12, COLORS.muted, 'right');
  } else if (block.kind === 'record') {
    const entry = block.entry, daily = entry.kind === 'daily';
    panel(renderer, 'relationship-entry', x, y, width, block.h, block.occurred ? 1 : 0.6);
    renderer.text(daily ? '日常小记' : `${STAR_NAMES[entry.stars]}星 · ${relationshipLabels[entry.stars - 1]}`, inner, y + 23, 14, block.occurred ? COLORS.teal : COLORS.muted, 'left', true);
    renderer.text(`超级订单${milestoneCount(entry)}张 · ${block.occurred ? '已收录' : `还差${milestoneCount(entry) - info.superOrdersCompleted}张`}`, inner, y + 48, 12, COLORS.muted);
    if (block.occurred) {
      renderer.text(block.expanded ? '−' : '+', x + width - 27, y + 28, 20, COLORS.teal, 'center');
      addHit(renderer, { x, y, w: width, h: 70 }, { type: 'customer-record-toggle', recordKey: block.recordKey, expanded: block.expanded });
      if (block.expanded) {
        let textY = y + 78;
        if (block.detail.length) textY += paragraph(renderer, block.detail, inner, textY, bodyWidth - 14, 12, COLORS.muted, 19) + 3;
        textY += paragraph(renderer, block.body, inner, textY, bodyWidth - 14, 13, COLORS.ink, 22);
        if (block.paidGift !== null) renderer.text(`${STAR_NAMES[entry.stars]}星礼 · ${block.paidGift} 金币 · 已到账`, inner, textY + 10, 12, COLORS.teal);
      }
    }
  }
}

function drawProfile(renderer, info, collection) {
  const back = { x: 19, y: 121, w: 46, h: 44 };
  renderer.roundRect(back.x, back.y, back.w, back.h, 12, '#fcf7e8', '#bac7ab');
  renderer.text('‹', back.x + back.w / 2, back.y + 21, 31, COLORS.teal, 'center');
  renderer.text(info.customer.name, 195, 143, 19, COLORS.ink, 'center', true);
  addHit(renderer, back, { type: 'customer-back' }, false);
  const layout = profileLayout(renderer, info, collection);
  renderer.customerScrollMax = Math.max(0, layout.height - CONTENT.h);
  setCustomerScroll(renderer, renderer.customerScroll);
  const ctx = renderer.ctx;
  ctx.save(); ctx.beginPath(); ctx.rect(CONTENT.x, CONTENT.y, CONTENT.w, CONTENT.h); ctx.clip();
  ctx.translate(0, CONTENT.y - renderer.customerScroll);
  layout.blocks.forEach(block => {
    if (block.y + block.h >= renderer.customerScroll && block.y <= renderer.customerScroll + CONTENT.h) drawProfileBlock(renderer, info, block);
  });
  ctx.restore();
}

function dialogueFor(info) {
  if (!info.eligible) return { title: '等待相遇', text: '这位街坊尚未开放，结识后可以听他说说话。' };
  if (!info.collected) return { title: '初次相遇', text: '完成首次订单后，才会收录第一句对白。' };
  const daily = (info.customer.daily || []).filter(entry => milestoneCount(entry) <= info.superOrdersCompleted).slice(-1)[0];
  const stage = info.customer.stages.filter(entry => milestoneCount(entry) <= info.superOrdersCompleted).slice(-1)[0];
  if (daily) return { title: '日常对白', text: daily.text };
  if (stage) return { title: '相处片段', text: stage.dialogue };
  return { title: '普通交单', text: info.customer.stages[0].reply };
}

function drawBubble(renderer, info, visual) {
  const dialogue = dialogueFor(info);
  const supplied = visual && visual.customerDialogue;
  if (supplied && supplied.customerId === info.customer.id && supplied.text) {
    dialogue.text = supplied.text;
    dialogue.title = supplied.title || (supplied.kind === 'daily' ? '日常对白' : supplied.kind === 'first-meeting' ? '初次结识' : supplied.kind === 'ordinary' ? '普通交单' : '相处片段');
  }
  const body = lines(renderer, dialogue.text, 232, 13), height = Math.max(140, 71 + body.length * 22);
  const y = 769 - height, bubble = { x: 86, y, w: 285, h: height };
  renderer.ctx.save(); renderer.ctx.fillStyle = 'rgba(53, 67, 48, 0.2)'; renderer.ctx.fillRect(0, 119, 390, 654);
  renderer.contain(`${info.eligible ? 'customer' : 'customer-silhouette'}/${info.customer.id}`, 18, y + 9, 74, 86);
  panel(renderer, 'speech-bubble', bubble.x, bubble.y, bubble.w, bubble.h);
  renderer.text(info.customer.name, bubble.x + 19, y + 27, 14, COLORS.ink, 'left', true);
  renderer.text(dialogue.title, bubble.x + 19, y + 49, 10, COLORS.muted);
  paragraph(renderer, body, bubble.x + 19, y + 77, 232, 13, COLORS.ink, 22);
  renderer.text('×', bubble.x + bubble.w - 23, y + 23, 24, COLORS.muted, 'center');
  renderer.ctx.restore();
  renderer.customerBubbleRect = bubble;
  renderer.customerBubbleClose = { x: bubble.x + bubble.w - 46, y, w: 46, h: 46 };
}

function scrollbar(renderer) {
  if (!renderer.customerScrollMax) return;
  const view = renderer.customerViewport;
  const height = Math.max(32, view.h * view.h / (view.h + renderer.customerScrollMax));
  const y = view.y + (view.h - height) * renderer.customerScroll / renderer.customerScrollMax;
  renderer.roundRect(376, y, 3, height, 1.5, '#9ab59b');
}

function drawCustomers(renderer, model, visual = {}) {
  renderer.customerViewport = { ...CONTENT };
  renderer.customerHitRegions = [];
  renderer.customerBubbleRect = null;
  const collection = model.customerCollection().map(infoFor);
  const selected = collection.find(info => info.customer.id === renderer.customerSelectedId);
  renderer.ctx.save();
  renderer.roundRect(11, 116, 368, 658, 18, '#f3f3e3', '#bacbaa');
  if (selected) drawProfile(renderer, selected, collection); else drawCollection(renderer, collection);
  scrollbar(renderer);
  if (selected && renderer.customerBubbleOpen) drawBubble(renderer, selected, visual);
  renderer.ctx.restore();
}

function setCustomerScroll(renderer, value) {
  renderer.customerScroll = Math.max(0, Math.min(renderer.customerScrollMax || 0, Number(value) || 0));
  return renderer.customerScroll;
}

function drawCustomerResponse(renderer, response) {
  if (!response || !response.text) return;
  const customer = getCustomer(response.customerId);
  if (!customer) return;
  const x = 19, y = 670;
  renderer.ctx.save();
  renderer.roundRect(x, y + 5, 352, 94, 13, '#f4ecdf');
  renderer.contain(`customer/${customer.id}`, x - 1, y + 20, 69, 69);
  panel(renderer, 'speech-bubble', x + 65, y, 287, 99);
  renderer.text(customer.name + (response.reward ? ' · 订单 +' + response.reward : ''), x + 82, y + 22, 13, COLORS.ink, 'left', true);
  const body = lines(renderer, response.text, 247, 12);
  if (body.length > 2) {
    body.length = 2;
    font(renderer, 12, false);
    while (body[1] && renderer.ctx.measureText(body[1] + '…').width > 247) body[1] = body[1].slice(0, -1);
    body[1] += '…';
  }
  paragraph(renderer, body, x + 82, y + 48, 247, 12, COLORS.ink, 21);
  renderer.customerResponseClose = { x: 327, y, w: 44, h: 44 };
  renderer.text('×', 349, y + 21, 22, COLORS.muted, 'center');
  renderer.ctx.restore();
}

// Coordinates are already converted to the game's 390 x 844 design space.
function customerHitTest(renderer, x, y) {
  if (renderer.customerBubbleOpen && renderer.customerBubbleRect) {
    if (within(x, y, renderer.customerBubbleClose) || (y >= 119 && y < 774 && !within(x, y, renderer.customerBubbleRect))) return { type: 'customer-bubble-close' };
    if (within(x, y, renderer.customerBubbleRect)) return { type: 'customer-bubble' };
  }
  const regions = renderer.customerHitRegions || [];
  for (let index = regions.length - 1; index >= 0; index--) {
    const region = regions[index];
    if (within(x, y, region)) return region.hit;
  }
  if (within(x, y, renderer.customerViewport || CONTENT)) return { type: 'customer-scroll', customerScrollable: true };
  return null;
}

module.exports = { drawCustomers, customerHitTest, setCustomerScroll, drawCustomerResponse };
