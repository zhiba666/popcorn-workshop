const starPoints = '12,2 14.9,8.2 21.7,9 16.7,13.6 18.1,20.3 12,16.9 5.9,20.3 7.3,13.6 2.3,9 9.1,8.2';
const starNames = ['零', '一', '二', '三', '四', '五'];

function starShape() {
  return `<svg class="c-star-shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="${starPoints}"></polygon></svg>`;
}

function finiteCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

export function starsMarkup(stars, { next = false } = {}) {
  const count = Math.min(5, finiteCount(stars));
  return `<span class="c-stars" role="img" aria-label="${count}星，共五星">${Array.from({ length: 5 }, (_, index) =>
    `<span class="c-star ${index < count ? 'is-lit' : 'is-empty'}${next && index === count ? ' is-next' : ''}" aria-hidden="true">${starShape()}</span>`).join('')}</span>`;
}

export function progressTrackMarkup(progress) {
  if (progress.stars === 5) return '';
  const goal = Math.max(1, finiteCount(progress.goal, 1));
  const current = Math.min(goal, finiteCount(progress.current));
  const remaining = finiteCount(progress.remaining);
  const ratio = current / goal * 100;
  return `<div class="c-progress-track" data-state="${current ? 'partial' : 'empty'}" role="progressbar" aria-label="当前星段超级订单进度" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${current}" aria-valuetext="本阶段超级订单${current}/${goal}张，还差${remaining}张"><span class="c-progress-fill" style="width:${ratio}%"></span><span class="c-progress-ticks" aria-hidden="true">${Array.from({ length: goal }, (_, index) => `<span class="c-progress-tick${index < current ? ' is-complete' : ''}"></span>`).join('')}</span></div>`;
}

export function statusTagsMarkup({ visiting = false, unreadKind = null } = {}) {
  const tags = [];
  if (visiting) tags.push('<span class="c-tag is-visiting"><span class="c-status-dot" aria-hidden="true"></span>正在来访</span>');
  if (unreadKind === 'daily') tags.push('<span class="c-tag is-unread is-daily"><span class="c-status-note" aria-hidden="true"></span>新日常</span>');
  if (unreadKind === 'collected') tags.push('<span class="c-tag is-unread is-collected"><span class="c-status-note" aria-hidden="true"></span>新结识</span>');
  return tags.length ? `<span class="c-tags">${tags.join('')}</span>` : '';
}

export function growthForecastMarkup(progress, { visiting = false, superOrder = false } = {}) {
  if (!superOrder) return visiting ? '<div class="c-growth-forecast"><div class="c-forecast-copy"><small class="c-forecast-kicker">普通订单</small><strong>本单不推进升星</strong><span class="c-forecast-note">交付可获得订单金币，不发放星级礼金</span></div></div>' : '';
  if (progress.stars === 5) return '';
  const stars = Math.min(4, finiteCount(progress.stars));
  const remaining = Math.max(1, finiteCount(progress.remaining, 1));
  const nextStar = Math.min(5, Math.max(1, finiteCount(progress.nextStar, stars + 1)));
  const imminent = remaining === 1;
  const message = stars === 0 ? '完成首张超级订单，达到一星' : imminent
    ? `再完成1张超级订单，${nextStar === 5 ? '成为老朋友' : `达到${starNames[nextStar]}星`}`
    : `再交付1张后，还差${remaining - 1}张超级订单升${starNames[nextStar]}星`;
  const gift = finiteCount(progress.nextGift);
  return `<div class="c-growth-forecast${imminent ? ' is-imminent' : ''}"><span class="c-forecast-icon" aria-hidden="true">${starShape()}</span><div class="c-forecast-copy"><small class="c-forecast-kicker">超级订单成长预告 · 示例</small><strong>${message}</strong>${imminent ? `<span class="c-forecast-note">${starNames[nextStar]}星礼 · ${gift} 金币，达到星级时到账</span>` : ''}</div></div>`;
}
