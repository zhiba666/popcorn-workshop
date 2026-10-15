'use strict';

const WIDTH = 390;
const HEIGHT = 844;
const IDS = {
  background: 'entry/scene/background-workshop',
  production: 'entry/scene/hero-production',
  rabbit: 'entry/scene/rabbit-host',
  title: 'entry/ui/title-sign',
  enter: 'entry/ui/button-enter',
  settings: 'entry/ui/button-settings',
  settingsIcon: 'entry/icons/settings',
};

function assetRect(renderer, id, fallback) {
  const metadata = renderer.assets && renderer.assets.meta(id);
  const rect = metadata && metadata.layout && metadata.layout.rect || fallback;
  return { x: rect[0], y: rect[1], w: rect[2], h: rect[3] };
}

function contains(point, rect) {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.w && point.y <= rect.y + rect.h;
}

function tapRect(rect, scale) {
  const w = Math.max(rect.w, 44 / scale), h = Math.max(rect.h, 44 / scale);
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

function createEntryLayout(renderer) {
  // Entry art uses its own safe-area transform. Gameplay retains its existing viewport.
  renderer.entryScale = Math.min(renderer.width / WIDTH,
    Math.max(1, renderer.height - renderer.safeTop - renderer.safeBottom) / HEIGHT);
  renderer.entryOffsetX = (renderer.width - WIDTH * renderer.entryScale) / 2;
  renderer.entryOffsetY = renderer.safeTop +
    (renderer.height - renderer.safeTop - renderer.safeBottom - HEIGHT * renderer.entryScale) / 2;
  const layout = {
    production: assetRect(renderer, IDS.production, [111, 248, 360, 399.5]),
    rabbit: assetRect(renderer, IDS.rabbit, [13, 356, 228, 343.5]),
    title: assetRect(renderer, IDS.title, [0, 22, 390, 192.5]),
    enter: assetRect(renderer, IDS.enter, [39, 695, 312, 97.5]),
    settings: assetRect(renderer, IDS.settings, [338, 12, 47, 43.5]),
    settingsIcon: assetRect(renderer, IDS.settingsIcon, [347.5, 20.5, 28, 27]),
    panel: { x: 34, y: 290, w: 322, h: 222 },
    close: { x: 300, y: 304, w: 44, h: 44 },
    motion: { x: 56, y: 376, w: 278, h: 64 },
    recoveryPanel: { x: 24, y: 215, w: 342, h: 418 },
    recoveryPrimary: { x: 54, y: 450, w: 282, h: 60 },
    recoverySecondary: { x: 54, y: 530, w: 282, h: 54 },
  };
  // Position the visible central machine like the reference, preserving the right-edge crop.
  layout.production.x -= 24;
  const menu = renderer.menuBounds, scale = renderer.entryScale;
  if (menu) {
    const settings = layout.settings;
    const left = renderer.entryOffsetX + settings.x * scale;
    const right = left + settings.w * scale;
    const top = renderer.entryOffsetY + settings.y * scale;
    const bottom = top + settings.h * scale;
    if (menu.left < right + 8 && menu.right > left - 8 && menu.bottom > top - 8 &&
        (menu.top === undefined || menu.top < bottom + 8)) {
      const shift = Math.max(0, (menu.bottom + 8 - top) / scale);
      settings.y += shift;
      layout.settingsIcon.y += shift;
    }
  }
  layout.enterTap = tapRect(layout.enter, scale);
  layout.settingsTap = tapRect(layout.settings, scale);
  layout.closeTap = tapRect(layout.close, scale);
  layout.motionTap = tapRect(layout.motion, scale);
  layout.recoveryPrimaryTap = tapRect(layout.recoveryPrimary, scale);
  layout.recoverySecondaryTap = tapRect(layout.recoverySecondary, scale);
  renderer.entryLayout = layout;
}

function entryHitTest(renderer, x, y) {
  const point = { x: (x - renderer.entryOffsetX) / renderer.entryScale,
    y: (y - renderer.entryOffsetY) / renderer.entryScale };
  const layout = renderer.entryLayout;
  if (renderer.recovery) {
    if (contains(point, layout.recoveryPrimaryTap)) return { type: renderer.recovery.confirm ? 'entry-recovery-confirm' : 'entry-recovery-retry' };
    if (contains(point, layout.recoverySecondaryTap)) return { type: renderer.recovery.confirm ? 'entry-recovery-cancel' : 'entry-recovery-new' };
    return null;
  }
  if (renderer.entrySettingsOpen) {
    if (contains(point, layout.closeTap)) return { type: 'entry-settings-close' };
    if (contains(point, layout.motionTap)) return { type: 'entry-motion-toggle' };
    return null;
  }
  if (contains(point, layout.settingsTap)) return { type: 'entry-settings-open' };
  if (contains(point, layout.enterTap)) return { type: 'entry-enter' };
  return null;
}

function pressed(renderer, visual, type) {
  const gesture = visual.gesture;
  if (visual.reducedMotion || !gesture || gesture.hit.type !== type) return false;
  const hit = entryHitTest(renderer, gesture.x, gesture.y);
  return !!hit && hit.type === type;
}

function pressTransform(renderer, rect, active, draw) {
  const ctx = renderer.ctx;
  ctx.save();
  if (active) {
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.scale(0.96, 0.96);
    ctx.translate(-rect.x - rect.w / 2, -rect.y - rect.h / 2);
  }
  draw();
  ctx.restore();
}

function imageRect(renderer, id, rect) {
  renderer.image(id, rect.x, rect.y, rect.w, rect.h);
}

function cartoonText(renderer, value, x, y, size, maxWidth, title) {
  const ctx = renderer.ctx;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const fontSize = Math.min(size, title ? 52 : 38);
  ctx.font = 'bold ' + fontSize + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = title ? '#714020' : '#1a6356';
  ctx.fillText(value, x, y + (title ? 4 : 2), maxWidth);
  ctx.strokeStyle = title ? '#714020' : '#1a6356';
  ctx.lineWidth = title ? 2.5 : 1.5;
  ctx.strokeText(value, x, y, maxWidth);
  ctx.fillStyle = '#fff6dc';
  ctx.fillText(value, x, y, maxWidth);
  ctx.restore();
}

function drawSettings(renderer, visual) {
  const ctx = renderer.ctx, layout = renderer.entryLayout;
  // Dim the complete viewport, including the area outside the contained illustration.
  ctx.save();
  const dpr = renderer.canvas.width / renderer.width;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#3b2c22a6';
  ctx.fillRect(0, 0, renderer.width, renderer.height);
  ctx.restore();
  const panel = layout.panel;
  renderer.slice('ui/panel-cream', panel.x, panel.y, panel.w, panel.h);
  renderer.text('设置', WIDTH / 2, panel.y + 37, 26, '#5f341c', 'center', true);
  pressTransform(renderer, layout.close, pressed(renderer, visual, 'entry-settings-close'), () => {
    renderer.slice('ui/button-teal', layout.close.x, layout.close.y, layout.close.w, layout.close.h);
    renderer.text('×', layout.close.x + layout.close.w / 2, layout.close.y + layout.close.h / 2 - 1,
      28, '#fff6dc', 'center', true);
  });
  pressTransform(renderer, layout.motion, pressed(renderer, visual, 'entry-motion-toggle'), () => {
    const row = layout.motion;
    renderer.roundRect(row.x, row.y, row.w, row.h, 13, '#f4e6cf', '#d8c29d');
    renderer.text('减少动效', row.x + 17, row.y + row.h / 2, 19, '#5f341c', 'left', true);
    const track = { x: row.x + row.w - 78, y: row.y + 17, w: 60, h: 30 };
    renderer.roundRect(track.x, track.y, track.w, track.h, 15, visual.reducedMotion ? '#237b72' : '#b5a58b');
    renderer.roundRect(track.x + (visual.reducedMotion ? 33 : 3), track.y + 3, 24, 24, 12, '#fff6dc');
  });
  renderer.text(visual.reducedMotion ? '已开启' : '已关闭', WIDTH / 2, panel.y + 185,
    14, '#9b7c60', 'center');
}

function drawRecovery(renderer, visual) {
  const ctx = renderer.ctx, layout = renderer.entryLayout, recovery = renderer.recovery;
  ctx.save();
  const dpr = renderer.canvas.width / renderer.width;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#3b2c22b8';
  ctx.fillRect(0, 0, renderer.width, renderer.height);
  ctx.restore();
  const panel = layout.recoveryPanel;
  renderer.slice('ui/panel-cream', panel.x, panel.y, panel.w, panel.h);
  renderer.text(recovery.title, WIDTH / 2, 258, 25, '#5f341c', 'center', true);
  recovery.lines.forEach((line, index) => renderer.text(line, WIDTH / 2, 310 + index * 29, 16, '#765b40', 'center'));
  if (recovery.message) renderer.text(recovery.message, WIDTH / 2, 416, 15, '#a63f2f', 'center', true);
  else if (recovery.confirm) renderer.text('备份或保存失败时，不会开始新游戏', WIDTH / 2, 416, 15, '#765b40', 'center');
  const buttons = recovery.confirm ?
    [['entry-recovery-confirm', '备份并重新开始'], ['entry-recovery-cancel', '返回']] :
    [['entry-recovery-retry', '重试读取'], ['entry-recovery-new', '重新开始']];
  buttons.forEach(([type, label], index) => {
    const rect = index ? layout.recoverySecondary : layout.recoveryPrimary;
    pressTransform(renderer, rect, pressed(renderer, visual, type), () => {
      if (index) renderer.roundRect(rect.x, rect.y, rect.w, rect.h, 13, '#f0e2c9', '#c9b58f');
      else renderer.slice('ui/button-teal', rect.x, rect.y, rect.w, rect.h);
      renderer.text(label, rect.x + rect.w / 2, rect.y + rect.h / 2, 20,
        index ? '#765238' : '#fff6dc', 'center', true);
    });
  });
  renderer.text('完成恢复后才能进入工坊', WIDTH / 2, 610, 14, '#9b7c60', 'center');
}

function drawEntry(renderer, visual) {
  const ctx = renderer.ctx, dpr = renderer.canvas.width / renderer.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#e8d7bd';
  ctx.fillRect(0, 0, renderer.canvas.width, renderer.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const background = renderer.assets && renderer.assets.get(IDS.background);
  if (background) {
    const scale = Math.max(renderer.width / background.width, renderer.height / background.height);
    const w = background.width * scale, h = background.height * scale;
    ctx.drawImage(background, (renderer.width - w) / 2, (renderer.height - h) / 2, w, h);
  }
  ctx.setTransform(dpr * renderer.entryScale, 0, 0, dpr * renderer.entryScale,
    dpr * renderer.entryOffsetX, dpr * renderer.entryOffsetY);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const layout = renderer.entryLayout;
  // Keep foreground art inside the designed composition while the background fills the screen.
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, WIDTH, HEIGHT); ctx.clip();
  imageRect(renderer, IDS.production, layout.production);
  imageRect(renderer, IDS.rabbit, layout.rabbit);
  imageRect(renderer, IDS.title, layout.title);
  cartoonText(renderer, '爆米花工坊', WIDTH / 2, layout.title.y + 132.5, 55, 294, true);
  pressTransform(renderer, layout.enter, pressed(renderer, visual, 'entry-enter'), () => {
    imageRect(renderer, IDS.enter, layout.enter);
    cartoonText(renderer, '进入游戏', layout.enter.x + layout.enter.w / 2,
      layout.enter.y + layout.enter.h / 2 - 2, 42, 206, false);
  });
  pressTransform(renderer, layout.settings, pressed(renderer, visual, 'entry-settings-open'), () => {
    imageRect(renderer, IDS.settings, layout.settings);
    imageRect(renderer, IDS.settingsIcon, layout.settingsIcon);
  });
  ctx.restore();
  if (renderer.recovery) drawRecovery(renderer, visual);
  else {
    if (renderer.entrySettingsOpen) drawSettings(renderer, visual);
    renderer.toast(visual);
  }
}

module.exports = { createEntryLayout, entryHitTest, drawEntry };
