'use strict';

const { drawFactoryNavigation } = require('./factory-navigation');
const { lineProductionFeedback } = require('./production-feedback');

const COLORS = { text: '#4d2d18', muted: '#9b7c60', cream: '#fff6e6', teal: '#237b72' };
const stockText = value => {
  if (value < 10000) return String(value);
  const [unit, suffix] = value >= 1e11 ? [1e12, '万亿'] : value >= 1e7 ? [1e8, '亿'] : [1e4, '万'];
  const amount = value / unit;
  return (amount < 10 ? amount.toFixed(1) : Math.round(amount)) + suffix;
};

function clippedText(r, text, rect, size, color, align = 'left', bold = false) {
  const c = r.ctx;
  c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
  r.text(text, align === 'right' ? rect.x + rect.w : rect.x, rect.y + rect.h / 2,
    size, color, align, bold);
  c.restore();
}

function drawCameraControls(r, model) {
  const layout = r.layout || {}, overview = r.factoryViewMode === 'overview';
  const mode = layout.factoryMode || { x: 278, y: 242, w: 92, h: 54 };
  r.roundRect(mode.x, mode.y + 2, mode.w, mode.h - 4, 10, COLORS.cream, '#b8cdb6');
  r.text(overview ? '返回近景' : '工厂总览', mode.x + mode.w / 2,
    mode.y + mode.h / 2, 14, COLORS.teal, 'center', true);
  if (overview) return;
  const home = layout.factoryHome || { x: 278, y: 302, w: 92, h: 54 };
  r.roundRect(home.x, home.y + 2, home.w, home.h - 4, 10, COLORS.cream, '#b8cdb6');
  r.text('归位', home.x + home.w / 2, home.y + home.h / 2, 14, COLORS.teal, 'center', true);
  if (!r.factoryServiceFocus) return;
  const service = r.factoryServiceFocus, rect = layout.factoryService || { x: 20, y: 242, w: 246, h: 54 };
  const name = { supply: '公共供料', packaging: '公共包装', warehouse: '仓储' }[service];
  if (!name) return;
  r.roundRect(rect.x, rect.y + 2, rect.w, rect.h - 4, 10, COLORS.cream, '#b8cdb6');
  r.text(name, rect.x + 12, rect.y + rect.h / 2, 14, COLORS.teal, 'left', true);
  r.text(service === 'warehouse' ? '库存 ' + stockText(model.state.lines.reduce((sum, line) => sum + line.inventory, 0)) : '查看配套 ›',
    rect.x + rect.w - 12, rect.y + rect.h / 2, 13, COLORS.teal, 'right');
}

function drawFactoryControls(r, model, visual = {}) {
  const selected = model.getLine();
  if (!selected) return;
  const layout = r.layout || {}, expanded = !!r.factoryDockExpanded;
  const dock = layout.factoryDock || { x: 19, y: expanded ? 626 : 704, w: 352, h: expanded ? 147 : 69 };
  const feedback = lineProductionFeedback(model.state, selected);
  const journey = visual.factoryPresentation?.construction;
  const currentJourney = journey && journey.lineId === selected.id ? journey : null;
  const status = (currentJourney?.text || feedback.text).split(' · ')[0];
  const progress = Math.max(0, Math.min(1, currentJourney ? currentJourney.progress : feedback.progress));
  r.slice('ui/panel-cream', dock.x, dock.y, dock.w, dock.h);
  r.contain('factory/' + r.machineId(selected.product), dock.x + 48, dock.y + 9, 40, 43);
  clippedText(r, r.lineName(selected), { x: dock.x + 94, y: dock.y + 6, w: 185, h: 24 },
    14, COLORS.text, 'left', true);
  r.text(expanded ? '⌄' : '⌃', dock.x + dock.w - 68, dock.y + 17, 17, COLORS.teal, 'center', true);
  r.text('库存 ' + stockText(selected.inventory), dock.x + 94, dock.y + 40, 12, COLORS.text, 'left', true);
  clippedText(r, status, { x: dock.x + 201, y: dock.y + 29, w: 94, h: 22 },
    12, currentJourney?.completed ? COLORS.teal : COLORS.muted, 'right');
  r.roundRect(dock.x + 94, dock.y + 56, 196, 3, 1.5, '#ded0b7');
  r.roundRect(dock.x + 94, dock.y + 56, Math.max(2, 196 * progress), 3, 1.5, '#2d9b87');
  if (expanded) {
    const cached = (selected.buffer || []).length;
    r.roundRect(dock.x + 13, dock.y + 64, dock.w - 26, 19, 6, '#edf1dc');
    r.text('出厂 Lv.' + selected.outputLevel + '  ·  产能 ' + selected.capacityLevel + '档  ·  缓存 ' + cached + '批',
      dock.x + dock.w / 2, dock.y + 74, 12, COLORS.teal, 'center');
    r.button('ui/button-teal', '加速', layout.accelerate || { x: 28, y: 714, w: 90, h: 48 },
      selected.factory.phase === 'processing');
    r.button('ui/upgrade-button-green', '流水线升级', layout.upgradeOpen || { x: 125, y: 714, w: 139, h: 48 });
    r.button('ui/button-teal', '扩线', layout.lineExpansionOpen || { x: 272, y: 714, w: 84, h: 48 });
  }
  drawCameraControls(r, model);
  drawFactoryNavigation(r, model, visual);
}

function drawFactoryOrderSummary(r, model) {
  const order = model.getOrder(), progress = order && model.orderProgress(order.id);
  if (!order || !progress) return;
  const rect = r.layout?.factoryOrder || { x: 19, y: 80, w: 352, h: 50 };
  const centerY = rect.y + rect.h / 2;
  r.visibleOrderId = order.id;
  r.slice('ui/panel-cream', rect.x, rect.y, rect.w, rect.h);
  r.roundRect(rect.x + 7, rect.y + 6, 37, rect.h - 12, 9, '#e4edda');
  r.contain('customer/' + order.customerId, rect.x + 7, rect.y + 4, 37, rect.h - 8);
  const requirements = progress.requirements;
  requirements.forEach((requirement, index) => {
    const x = rect.x + 52 + index * 56, ready = requirement.boardUnits === 1;
    r.contain('product/' + requirement.product + '/' + requirement.level, x, centerY - 15, 27, 30);
    r.text(requirement.level + '+', x + 31, centerY - 8, 12, COLORS.text, 'left', true);
    r.text((ready ? '1' : '0') + '/1', x + 31, centerY + 10, 12,
      ready ? COLORS.teal : COLORS.muted, 'left', true);
  });
  const rewardCenter = rect.x + rect.w - 91;
  r.contain('icon/coin', rewardCenter - 10, centerY - 21, 20, 20);
  r.text('+' + stockText(order.reward), rewardCenter, centerY + 12, 13, COLORS.text, 'center', true);
  r.roundRect(rect.x + rect.w - 52, rect.y + 7, 1, rect.h - 14, .5, '#dfd2b9');
  r.text('展开 ›', rect.x + rect.w - 27, centerY, 12, COLORS.teal, 'center', true);
}

module.exports = { drawFactoryControls, drawFactoryOrderSummary };
