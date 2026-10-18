'use strict';

const COLORS = {
  brown: '#5f341c', muted: '#8f7656', green: '#075731', red: '#ba3843',
  cream: '#fff8e7', mint: '#e5f1d5', gold: '#f7e3b3'
};
const TABS = {
  capacity: { x: 31, y: 250, w: 160, h: 46 },
  output: { x: 199, y: 250, w: 160, h: 46 }
};
const CARD = { x: 28, y: 306, w: 334, h: 420 };
const BUY = { x: 41, y: 738, w: 308, h: 48 };
const DETAILS = { x: 41, y: 678, w: 308, h: 44 };
const HIDDEN_BUY = { x: -10000, y: -10000, w: 0, h: 0 };
const seconds = value => Math.round(value * 100) / 100;
const stock = value => {
  if (value < 10000) return String(value);
  const [unit, suffix] = value >= 1e11 ? [1e12, '万亿'] : value >= 1e7 ? [1e8, '亿'] : [1e4, '万'];
  const amount = value / unit;
  return (amount < 10 ? amount.toFixed(1) : Math.round(amount)) + suffix;
};

function drawTabs(r, tab) {
  for (const key of ['capacity', 'output']) {
    const rect = TABS[key], active = key === tab;
    r.roundRect(rect.x, rect.y, rect.w, rect.h, 11,
      active ? key === 'capacity' ? '#237b62' : '#ad702e' : '#eee2ca', active ? '#fff7df' : '#d7c5a3');
    r.contain(key === 'capacity' ? 'icon/upgrade-capacity' : 'icon/upgrade-output-level',
      rect.x + 15, rect.y + 9, 28, 28, active ? 1 : .65);
    r.text(key === 'capacity' ? '加工提速' : '出厂升阶', rect.x + 92, rect.y + 23,
      18, active ? COLORS.cream : COLORS.brown, 'center', true);
  }
}

function drawHeader(r, line) {
  const panel = r.layout.upgradePanel, title = r.layout.upgradeTitle, close = r.layout.upgradeClose;
  r.ctx.fillStyle = '#3f3028a8';
  r.ctx.fillRect(0, 0, 390, 844);
  r.slice('ui/upgrade-panel-cream', panel.x, panel.y, panel.w, panel.h);
  r.slice('ui/upgrade-title-sign', title.x, title.y, title.w, title.h);
  r.text('流水线升级', 195, 128, 24, COLORS.brown, 'center', true);
  r.contain('ui/upgrade-button-close', close.x, close.y, close.w, close.h);
  r.slice('ui/upgrade-well-mint', 31, 161, 100, 82);
  r.contain('factory/' + r.machineId(line.product), 29, 157, 104, 90);
  r.text(r.lineName(line), 146, 180, 20, COLORS.brown, 'left', true);
  r.slice('ui/upgrade-inset-cream', 144, 203, 211, 34);
  r.text('Lv.' + line.outputLevel + '  ·  库存 ' + stock(line.inventory) + '份',
    250, 220, 13, COLORS.brown, 'center', true);
}

function drawCapacity(r, offer, line) {
  const next = offer.maxed ? offer.level : offer.level + 1;
  r.slice('ui/upgrade-card-mint', CARD.x, CARD.y, CARD.w, CARD.h);
  r.text(offer.maxed ? '机器周期 · 已满档' : '机器周期更短', 195, 335, 21, COLORS.green, 'center', true);
  r.slice('ui/upgrade-inset-cream', 41, 359, 308, 113);
  r.text('当前 ' + offer.level + '档', 116, 382, 14, COLORS.muted, 'center');
  r.text(offer.maxed ? '当前最高档' : '升级后 ' + next + '档', 278, 382, 14, COLORS.muted, 'center');
  r.text(seconds(offer.currentCycleSeconds) + '秒', 116, 417, 26, COLORS.brown, 'center', true);
  r.contain('icon/upgrade-arrow-right', 182, 402, 27, 31);
  r.text(seconds(offer.nextCycleSeconds) + '秒', 278, 417, 26, COLORS.green, 'center', true);
  r.text('每批 ' + offer.batchUnits + ' 份 · 份数不变', 195, 454, 14, COLORS.muted, 'center');
  r.slice('ui/upgrade-ribbon-mint', 41, 487, 308, 38);
  r.text(offer.maxed ? '本线产能已达最高档' : '机器周期速度 +' + offer.speedGainPercent + '%',
    195, 506, 18, COLORS.green, 'center', true);
  r.text(offer.pending ? '已购档位将在下一批启用' : offer.maxed ? '当前档位已启用' : '下一批生效 · 仅当前产线',
    195, 551, 15, COLORS.green, 'center', true);
  r.text('在制批次按原档位完成', 195, 578, 14, COLORS.brown, 'center');
  r.roundRect(41, 600, 308, 64, 9, '#fff6e6');
  r.text('供料、缓存与包装等待另计', 195, 620, 14, COLORS.brown, 'center', true);
  r.text('库存 ' + stock(line.inventory) + '份保留 · 出厂等级不变', 195, 645, 13, COLORS.muted, 'center');
}

function drawOutput(r, offer, line) {
  const next = offer.maxed ? offer.level : offer.level + 1;
  r.slice('ui/upgrade-card-gold', CARD.x, CARD.y, CARD.w, CARD.h);
  r.text(offer.maxed ? '已购出厂规格 · 已满级' : '出厂商品升一级', 195, 335, 21, COLORS.brown, 'center', true);
  r.slice('ui/upgrade-inset-cream', 41, 354, 308, 99);
  r.contain('product/' + line.product + '/' + offer.level, 78, 356, 86, 63);
  r.contain('product/' + line.product + '/' + next, 226, 356, 86, 63);
  r.contain('icon/upgrade-arrow-right', 182, 378, 27, 31);
  r.text('当前 Lv.' + offer.level, 121, 436, 14, COLORS.brown, 'center', true);
  r.text(offer.maxed ? '当前最高级' : '升级后 Lv.' + next, 269, 436, 14, COLORS.green, 'center', true);
  r.text('备齐 Lv.' + offer.targetLevel + ' 商品，需要发射 / 合成', 195, 474, 14, COLORS.brown, 'center');
  r.text(offer.currentShots + '发 / ' + offer.currentMerges + '次', 116, 499, 17, COLORS.brown, 'center', true);
  r.contain('icon/upgrade-arrow-right', 186, 487, 21, 24);
  r.text(offer.nextShots + '发 / ' + offer.nextMerges + '次', 278, 499, 17, COLORS.green, 'center', true);
  r.roundRect(41, 519, 308, 79, 9, '#fff6e6', '#dec697');
  r.text(offer.maxed ? '当前库存 · Lv.' + offer.level : '现有库存折算 · Lv.' + offer.level + ' → Lv.' + next,
    195, 535, 13, COLORS.muted, 'center');
  r.text(offer.maxed ? stock(offer.inventoryBefore) + '份' :
    stock(offer.inventoryBefore) + '份 → ' + stock(offer.inventoryAfter) + '份',
    195, 558, 22, COLORS.brown, 'center', true);
  r.text(offer.maxed ? '当前规格库存保留' : offer.discardedBaseUnits ?
    '库存折算舍弃 ' + stock(offer.discardedBaseUnits) + ' 份一级材料' : '库存折算无舍弃',
    195, 583, 14, !offer.maxed && offer.discardedBaseUnits ? COLORS.red : COLORS.green, 'center', true);
  r.text((offer.maxed ? '新批 Lv.' : '升级后下一批 Lv.') + next + ' · ' +
    offer.nextBatchUnits + '份 / ' + seconds(offer.cycleSeconds) + '秒',
    195, 607, 14, COLORS.brown, 'center', true);
  r.text(offer.maxed && !offer.pending ? '本线已达最高出厂规格' :
    '旧批全部包装后汇总折算，余量舍弃', 195, 627, 13, COLORS.muted, 'center');
  r.text(offer.pending ? '已购 Lv.' + offer.level + ' · 正在等待旧批清算' :
    offer.maxed ? '当前规格已启用 · 仅当前产线' : '仅当前产线 · 下一批生效',
    195, 647, 13, offer.pending ? COLORS.green : COLORS.muted, 'center', offer.pending);
  r.text('棋盘等级保留 · 旧单目标与奖励不变', 195, 667, 13, COLORS.muted, 'center');
}

function drawDetails(r, tab) {
  const capacity = tab === 'capacity';
  r.slice(capacity ? 'ui/upgrade-card-mint' : 'ui/upgrade-card-gold', CARD.x, CARD.y, CARD.w, CARD.h);
  r.text('升级规则', 195, 337, 21, capacity ? COLORS.green : COLORS.brown, 'center', true);
  const paragraphs = capacity ? [
    ['只影响当前产线的机器周期。'],
    ['下一批按新档位开始加工；', '在制批次仍按原档位完成。'],
    ['供料、缓存与包装等待另计。', '若本线正在等料或等包装，', '可先查看公共设备的瓶颈。'],
    ['出厂等级、库存和棋盘商品不变。']
  ] : [
    ['仅升级当前产线的出厂规格。'],
    ['现有库存立即折算为新等级，', '不足一份的余量按一级材料舍弃。'],
    ['新批次按新规格启动；在制旧批', '继续完成生产，全部包装后汇总', '折算入库，不足一份的余量舍弃。'],
    ['棋盘商品保留原等级；', '已有订单的目标与奖励保持不变。']
  ];
  let y = 378;
  for (const paragraph of paragraphs) {
    for (const line of paragraph) {
      r.text(line, 49, y, 14, COLORS.brown);
      y += 24;
    }
    y += 12;
  }
}

function drawFactoryUpgrade(r, model) {
  const line = model.getLine(), capacity = model.capacityOffer(), output = model.outputOffer();
  r.capacityBuyEnabled = false;
  r.outputBuyEnabled = false;
  r.layout.capacityBuy = { ...HIDDEN_BUY };
  r.layout.outputBuy = { ...HIDDEN_BUY };
  if (!line || !capacity || !output) return;
  const tab = r.upgradeTab === 'output' ? 'output' : 'capacity';
  r.upgradeTab = tab;
  r.upgradeLineId = line.id;
  r.layout[tab === 'capacity' ? 'capacityBuy' : 'outputBuy'] = { ...BUY };
  const offer = tab === 'capacity' ? capacity : output;
  const enabled = !r.upgradeDetailsOpen && !offer.maxed && offer.affordable;
  r[tab === 'capacity' ? 'capacityBuyEnabled' : 'outputBuyEnabled'] = enabled;
  drawHeader(r, line);
  drawTabs(r, tab);
  if (r.upgradeDetailsOpen) drawDetails(r, tab);
  else if (tab === 'capacity') drawCapacity(r, capacity, line);
  else drawOutput(r, output, line);
  r.roundRect(DETAILS.x, DETAILS.y, DETAILS.w, DETAILS.h, 8, '#fff8e777');
  r.text(r.upgradeDetailsOpen ? '收起规则  ∧' : '查看升级规则  ∨',
    195, DETAILS.y + DETAILS.h / 2, 14, COLORS.brown, 'center', true);
  if (r.upgradeDetailsOpen) {
    r.slice(tab === 'capacity' ? 'ui/upgrade-button-green' : 'ui/upgrade-button-gold', BUY.x, BUY.y, BUY.w, BUY.h, .45);
    r.text('收起规则后继续升级', 195, BUY.y + BUY.h / 2, 17, COLORS.brown, 'center', true);
  } else r.upgradePurchaseButton(offer, tab, BUY, model.state.coins);
  r.text('仅升级当前流水线', 195, 807, 13, COLORS.muted, 'center');
}

function getFactoryUpgradeHit(r, p) {
  const within = rect => {
    const padding = Math.max(0, (44 / (r.scale || 1) - rect.h) / 2);
    return p.x >= rect.x && p.x <= rect.x + rect.w &&
      p.y >= rect.y - padding && p.y <= rect.y + rect.h + padding;
  };
  for (const tab of ['capacity', 'output']) {
    if (within(TABS[tab])) return { type: 'upgrade-tab', tab };
  }
  if (within(DETAILS)) return { type: 'upgrade-details' };
  return null;
}

module.exports = { drawFactoryUpgrade, getFactoryUpgradeHit };
