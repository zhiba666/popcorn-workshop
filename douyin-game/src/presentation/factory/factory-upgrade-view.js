'use strict';

const COLORS = { brown: '#5f341c', muted: '#8f7656', green: '#075731', red: '#ba3843', cream: '#fff8e7' };
const PANEL = { x: 14, y: 344, w: 362, h: 487 };
const TABS = { capacity: { x: 31, y: 420, w: 160, h: 46 }, output: { x: 199, y: 420, w: 160, h: 46 } };
const CARD = { x: 28, y: 476, w: 334, h: 196 };
const DETAILS = { x: 41, y: 675, w: 308, h: 44 };
const BUY = { x: 41, y: 753, w: 308, h: 48 };
const HIDDEN_BUY = { x: -10000, y: -10000, w: 0, h: 0 };
const seconds = value => Math.round(value * 100) / 100;
const stock = value => {
  if (value < 10000) return String(value);
  const [unit, suffix] = value >= 1e11 ? [1e12, '万亿'] : value >= 1e7 ? [1e8, '亿'] : [1e4, '万'];
  const amount = value / unit;
  return (amount < 10 ? amount.toFixed(1) : Math.round(amount)) + suffix;
};

function drawHeader(r, line) {
  r.layout.upgradePanel = { ...PANEL };
  r.layout.upgradeTitle = { x: PANEL.x, y: PANEL.y, w: PANEL.w, h: 70 };
  r.layout.upgradeClose = { x: 319, y: 351, w: 44, h: 44 };
  const c = r.ctx;
  c.fillStyle = '#3f30284d'; c.fillRect(0, 0, 390, 844);
  r.slice('ui/upgrade-panel-cream', PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  r.roundRect(173, 350, 44, 4, 2, '#c2ad88');
  r.contain('factory/' + r.machineId(line.product), 28, 362, 54, 48);
  r.text(r.lineName(line), 94, 373, 18, COLORS.green, 'left', true);
  r.text('出厂 Lv.' + line.outputLevel + ' · 产能 ' + line.capacityLevel + '档 · 独立升级',
    94, 399, 12, COLORS.muted);
  r.contain('ui/upgrade-button-close', 319, 351, 44, 44);
}

function drawTabs(r, selected) {
  for (const tab of ['capacity', 'output']) {
    const rect = TABS[tab], active = tab === selected;
    r.roundRect(rect.x, rect.y, rect.w, rect.h, 10,
      active ? tab === 'capacity' ? '#237b62' : '#ad702e' : '#eee2ca', active ? '#fff7df' : '#d7c5a3');
    r.contain(tab === 'capacity' ? 'icon/upgrade-capacity' : 'icon/upgrade-output-level',
      rect.x + 12, rect.y + 10, 26, 26, active ? 1 : .65);
    r.text(tab === 'capacity' ? '加工提速' : '出厂升阶', rect.x + 94, rect.y + 23,
      17, active ? COLORS.cream : COLORS.brown, 'center', true);
  }
}

function drawCapacity(r, offer, line) {
  const next = offer.maxed ? offer.level : offer.level + 1;
  r.slice('ui/upgrade-card-mint', CARD.x, CARD.y, CARD.w, CARD.h);
  r.text('当前 ' + offer.level + '档', 116, 494, 13, COLORS.muted, 'center');
  r.text(offer.maxed ? '已达最高档' : '升级后 ' + next + '档', 278, 494, 13, COLORS.muted, 'center');
  r.text(seconds(offer.currentCycleSeconds) + '秒', 116, 529, 27, COLORS.brown, 'center', true);
  r.contain('icon/upgrade-arrow-right', 182, 514, 27, 31);
  r.text(seconds(offer.nextCycleSeconds) + '秒', 278, 529, 27, COLORS.green, 'center', true);
  r.text('每批 ' + offer.batchUnits + '份 · 产量不变', 195, 560, 13, COLORS.muted, 'center');
  r.roundRect(41, 578, 308, 34, 8, '#d5eac9');
  r.text(offer.maxed ? '本线机器已达最高档' : '机器周期速度 +' + offer.speedGainPercent + '%',
    195, 595, 17, COLORS.green, 'center', true);
  r.text(offer.pending ? '已购档位将在下一批启用' : offer.maxed ? '当前档位已启用' : '下一批生效 · 在制批次按原档位完成',
    195, 632, 13, COLORS.green, 'center', true);
  r.text('供料、缓存与包装等待另计', 195, 654, 13, COLORS.muted, 'center');
}

function drawOutput(r, offer, line) {
  const next = offer.maxed ? offer.level : offer.level + 1;
  r.slice('ui/upgrade-card-gold', CARD.x, CARD.y, CARD.w, CARD.h);
  r.text('当前 Lv.' + offer.level, 116, 492, 13, COLORS.muted, 'center');
  r.text(offer.maxed ? '已达最高级' : '升级后 Lv.' + next, 278, 492, 13, COLORS.muted, 'center');
  r.contain('product/' + line.product + '/' + offer.level, 77, 505, 78, 45);
  r.contain('product/' + line.product + '/' + next, 239, 505, 78, 45);
  r.contain('icon/upgrade-arrow-right', 182, 513, 27, 31);
  r.text('备齐 Lv.' + offer.targetLevel + '：' + offer.currentShots + '发/' + offer.currentMerges + '合成 → ' +
    offer.nextShots + '发/' + offer.nextMerges + '合成', 195, 567, 13, COLORS.brown, 'center');
  r.roundRect(41, 582, 308, 59, 8, '#fff6e6', '#dec697');
  r.text(offer.maxed ? '当前库存保留' : '现有库存折算为 Lv.' + next, 195, 595, 12, COLORS.muted, 'center');
  r.text(offer.maxed ? stock(offer.inventoryBefore) + '份' : stock(offer.inventoryBefore) + '份 → ' + stock(offer.inventoryAfter) + '份',
    195, 616, 20, COLORS.brown, 'center', true);
  r.text(offer.maxed ? '当前规格库存保留' : offer.discardedBaseUnits ?
    '舍弃 ' + stock(offer.discardedBaseUnits) + '份一级材料余量' : '本次折算无舍弃',
    195, 634, 12, !offer.maxed && offer.discardedBaseUnits ? COLORS.red : COLORS.green, 'center');
  r.text(offer.pending ? '等待旧批包装完毕后汇总折算，余量舍弃' :
    offer.maxed ? '本线已达最高出厂规格' : '旧批全部包装后汇总折算，余量舍弃',
    195, 657, 12, offer.pending ? COLORS.green : COLORS.muted, 'center', offer.pending);
}

function drawDetails(r, tab) {
  const capacity = tab === 'capacity';
  r.slice(capacity ? 'ui/upgrade-card-mint' : 'ui/upgrade-card-gold', CARD.x, CARD.y, CARD.w, CARD.h);
  r.text('升级规则', 195, 494, 17, capacity ? COLORS.green : COLORS.brown, 'center', true);
  const lines = capacity ? [
    '只影响当前产线的机器周期。',
    '下一批按新档位加工，在制批次按原档位完成。',
    '供料、缓存与包装等待另计。',
    '等料或等包装时，可先定位公共设备的瓶颈。',
    '出厂等级、库存和棋盘商品保留。'
  ] : [
    '仅升级当前产线的出厂规格。',
    '现有库存立即折算，不足一份的余量舍弃。',
    '新批用新规格，在制旧批继续完成生产。',
    '旧批全部包装后汇总折算，',
    '不足一份的余量按一级材料舍弃。',
    '棋盘商品、已有订单目标与奖励保留。'
  ];
  lines.forEach((text, index) => r.text(text, 43, 526 + index * 23, 13, COLORS.brown));
}

function drawFactoryUpgrade(r, model) {
  const line = model.getLine(), capacity = model.capacityOffer(), output = model.outputOffer();
  r.capacityBuyEnabled = false; r.outputBuyEnabled = false;
  r.layout.capacityBuy = { ...HIDDEN_BUY }; r.layout.outputBuy = { ...HIDDEN_BUY };
  if (!line || !capacity || !output) return;
  const tab = r.upgradeTab === 'output' ? 'output' : 'capacity';
  r.upgradeTab = tab; r.upgradeLineId = line.id;
  r.layout[tab === 'capacity' ? 'capacityBuy' : 'outputBuy'] = { ...BUY };
  const offer = tab === 'capacity' ? capacity : output;
  const enabled = !r.upgradeDetailsOpen && !offer.maxed && offer.affordable;
  r[tab === 'capacity' ? 'capacityBuyEnabled' : 'outputBuyEnabled'] = enabled;
  drawHeader(r, line); drawTabs(r, tab);
  if (r.upgradeDetailsOpen) drawDetails(r, tab);
  else if (tab === 'capacity') drawCapacity(r, capacity, line);
  else drawOutput(r, output, line);
  r.roundRect(DETAILS.x, DETAILS.y, DETAILS.w, DETAILS.h, 8, '#fff8e777');
  r.text(r.upgradeDetailsOpen ? '收起规则  ∧' : '查看升级规则  ∨', 195, DETAILS.y + DETAILS.h / 2, 14, COLORS.brown, 'center', true);
  r.text('可用金币 ' + stock(model.state.coins), 43, 733, 14, COLORS.brown, 'left', true);
  if (!offer.maxed && !offer.affordable) r.text('还差 ' + stock(Math.max(0, offer.cost - model.state.coins)), 347, 733, 13, COLORS.red, 'right');
  if (r.upgradeDetailsOpen) {
    r.slice(tab === 'capacity' ? 'ui/upgrade-button-green' : 'ui/upgrade-button-gold', BUY.x, BUY.y, BUY.w, BUY.h, .45);
    r.text('收起规则后继续升级', 195, BUY.y + BUY.h / 2, 17, COLORS.brown, 'center', true);
  } else r.upgradePurchaseButton(offer, tab, BUY, model.state.coins);
  r.text(tab === 'capacity' ? '仅当前流水线 · 出厂等级与库存保留' : '仅当前流水线 · 下一批按新规格生产',
    195, 815, 12, COLORS.muted, 'center');
}

function getFactoryUpgradeHit(r, p) {
  const within = rect => {
    const padding = Math.max(0, (44 / (r.scale || 1) - rect.h) / 2);
    return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y - padding && p.y <= rect.y + rect.h + padding;
  };
  for (const tab of ['capacity', 'output']) if (within(TABS[tab])) return { type: 'upgrade-tab', tab };
  if (within(DETAILS)) return { type: 'upgrade-details' };
  return null;
}

module.exports = { drawFactoryUpgrade, getFactoryUpgradeHit };
