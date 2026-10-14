'use strict';

const { createPlatform } = require('./platform');
const { Assets } = require('./assets');
const { GameModel } = require('./model');
const { Renderer } = require('./renderer');
const { Input } = require('./input');
const { ProductionSession, mergeOfflineSummary } = require('./production-session');

function startGame() {
  const platform = createPlatform();
  let saved = null, saveReadFailed = false;
  try { saved = platform.readSave(); } catch (error) { saveReadFailed = true; platform.reportError(error); }
  const model = new GameModel(saved);
  // A failed read or invalid save must never be replaced by an automatic write.
  if (model.recoveryRequired) saveReadFailed = true;
  const assets = new Assets(platform);
  const renderer = new Renderer(platform.canvas, assets);
  let preferences = { reducedMotion: false };
  try {
    const savedPreferences = platform.readPreferences();
    preferences.reducedMotion = !!(savedPreferences && savedPreferences.reducedMotion === true);
  } catch (error) { platform.reportError(error); }
  let time = 0, lastFrame = null, loaded = false, progress = 0,
    lastSave = 0, toast = null, loadError = null, storageErrorReported = false,
    upgradeDialog = false, sharedUpgrade = null, lineExpansion = null, offlineSummary = null, entry = true, settingsOpen = false;
  const effects = [];
  const lineName = (lineId, product) => {
    const line = model.getLine(lineId);
    const number = String(lineId || '').match(/-(\d+)$/);
    const kind = product || (line && line.product);
    return (kind === 'caramel' ? '焦糖' : '原味') + (number ? number[1] : '') + '号线';
  };
  const closeLineExpansion = () => {
    lineExpansion = null;
    renderer.lineExpansionDialogOpen = false;
    renderer.lineExpansionProduct = null;
  };
  const closeSharedUpgrade = () => {
    sharedUpgrade = null;
    renderer.sharedUpgradeDialogOpen = false;
  };
  const session = new ProductionSession({
    model, now: () => platform.now(), writeSave: value => platform.writeSave(value),
    canWrite: !saveReadFailed, isVisible: platform.isVisible,
    onSaveError(error) {
      if (!storageErrorReported) {
        toast = { text: '存档失败，请检查设备存储空间', at: time, duration: 5 };
        platform.reportError(error); storageErrorReported = true;
      }
    },
    onSaveSuccess() {
      if (storageErrorReported && toast && toast.text === '存档失败，请检查设备存储空间') toast = null;
      storageErrorReported = false;
    },
    onProductionError(result) {
      toast = { text: '生产暂未结算，请重新进入检查存档', at: time, duration: 5 };
      platform.reportError(new Error('生产结算失败：' + (result && result.reason || 'unknown')));
    },
    onProductionRecovery() {
      if (toast && toast.text === '生产暂未结算，请重新进入检查存档') toast = null;
    },
  });
  const save = () => {
    if (session.visible) session.advance();
    const savedSuccessfully = session.checkpoint();
    if (savedSuccessfully) storageErrorReported = false;
    if (offlineSummary) offlineSummary.saveFailed = !savedSuccessfully;
    return savedSuccessfully;
  };
  const presentOfflineSummary = () => {
    if (entry) return;
    const next = session.takeOfflineSummary();
    if (!next) return;
    const summary = mergeOfflineSummary(offlineSummary, next);
    // A later successful checkpoint also persists all previous offline stock.
    summary.saveFailed = !session.lastSaveSucceeded;
    if (!summary.producedByLine.length) return;
    if (summary.seconds >= 60 || offlineSummary || summary.producedByLine.length > 2 || summary.saveFailed) {
      offlineSummary = summary;
      upgradeDialog = false;
      renderer.upgradeDialogOpen = false;
      closeLineExpansion();
      closeSharedUpgrade();
      renderer.offlineSummaryOpen = true;
      input.cancel();
    } else {
      const text = summary.producedByLine.map(item =>
        lineName(item.lineId, item.product) + item.level + '级' + item.units + '份').join('、');
      toast = { text: '离线入库：' + text + (summary.saveFailed ? '（未保存）' : ''), at: time, duration: 5 };
    }
  };
  const resize = () => {
    platform.canvas.width = Math.max(1, Math.round(platform.width * platform.pixelRatio));
    platform.canvas.height = Math.max(1, Math.round(platform.height * platform.pixelRatio));
    renderer.setViewport(platform.width, platform.height, platform.safeTop, platform.safeBottom, platform.menuBounds);
    if (platform.cancelInput) platform.cancelInput();
    input.cancel();
  };
  const reasons = {
    'empty-inventory': '正在生产，入库后就能取货', 'board-full': '棋盘已满，合成或交付腾出空格',
    incompatible: '同种同级的商品才能合成', 'max-level': '已达本轮最高商品等级',
    'order-not-ready': '先备齐订单所需的棋盘成品', 'launcher-protected': '发射器需要留在棋盘上',
    'order-not-found': '这张订单已更新，请查看当前订单',
    'order-edge': '已到订单列表边缘',
    'insufficient-coins': '金币不足，完成订单后再来升级', 'capacity-max': '本线产能已满',
    'output-max': '本轮出厂等级已达 Lv.2',
    'not-processing': '本批进入加工后可加速',
    'waiting-supply': '等待公共供料，备料后自动开始',
    'waiting-packaging': '等待公共包装，腾出位置后自动继续',
    'waiting-cache': '本线缓存已满，包装腾出位置后自动继续',
    'numeric-limit': '已达到当前可存储的数量上限',
    'line-max': '本产品流水线已达本轮上限',
    'invalid-product': '请选择已开放产品的流水线',
    'shared-max': '本轮公共设备已达最高档',
    'invalid-service': '请选择公共供料或公共包装',
  };
  const input = new Input(model, renderer, result => {
    if (platform.kind === 'browser') console.debug('[工坊操作]', JSON.stringify(result));
    if (!result.ok) {
      let text = reasons[result.reason] || '请拖到空格或相同等级的商品';
      if (result.action === 'line-buy') {
        const offer = model.lineExpansionOffer(result.product);
        const name = result.product === 'caramel' ? '焦糖' : '原味';
        if (result.reason === 'line-max' && offer) text = name + '本轮最多' + offer.maxLines + '条线';
        if (result.reason === 'board-full') text = '棋盘已满，腾出一格后才能新增流水线';
        if (result.reason === 'insufficient-coins' && offer) text = '金币不足，新增' + name + '流水线需' + offer.cost + '金币';
      }
      if (result.action === 'shared-upgrade') {
        const offer = model.sharedUpgradeOffer(result.service);
        const name = result.service === 'packaging' ? '公共包装' : '公共供料';
        if (result.reason === 'shared-max') text = name + '已达本轮最高档';
        if (result.reason === 'insufficient-coins' && offer) text = name + '升级需' + offer.cost + '金币';
      }
      toast = { text, at: time, duration: 2.5 };
      return;
    }
    const type = result.action;
    if (type === 'entry-enter') {
      entry = false; settingsOpen = false;
      renderer.entryOpen = false; renderer.entrySettingsOpen = false;
      input.cancel();
      if (saveReadFailed) toast = { text: '存档读取失败，本轮保留旧存档，请重新进入', at: time, duration: 8 };
      presentOfflineSummary();
      return;
    }
    if (type === 'entry-settings-open' || type === 'entry-settings-close') {
      settingsOpen = type === 'entry-settings-open';
      renderer.entrySettingsOpen = settingsOpen;
      input.cancel();
      return;
    }
    if (type === 'entry-motion-toggle') {
      preferences.reducedMotion = !preferences.reducedMotion;
      if (preferences.reducedMotion) effects.length = 0;
      try { platform.writePreferences(preferences); }
      catch (error) {
        toast = { text: '设置暂未保存，请检查设备存储空间', at: time, duration: 5 };
        platform.reportError(error);
      }
      return;
    }
    if (type === 'offline-close') {
      offlineSummary = null;
      renderer.offlineSummaryOpen = false;
      return;
    }
    if (type === 'upgrade-open' || type === 'upgrade-close') {
      upgradeDialog = type === 'upgrade-open';
      renderer.upgradeDialogOpen = upgradeDialog;
      if (upgradeDialog) { closeLineExpansion(); closeSharedUpgrade(); }
      input.cancel();
      return;
    }
    if (type === 'shared-upgrade-open') {
      sharedUpgrade = { focus: ['supply', 'packaging'].includes(result.service) ? result.service : null };
      renderer.sharedUpgradeDialogOpen = true;
      upgradeDialog = false;
      renderer.upgradeDialogOpen = false;
      closeLineExpansion();
      input.cancel();
      return;
    }
    if (type === 'shared-upgrade-close') {
      closeSharedUpgrade();
      input.cancel();
      return;
    }
    if (type === 'shared-upgrade') {
      if (platform.cancelInput) platform.cancelInput();
      input.cancel();
      const savedSuccessfully = save();
      const name = result.service === 'packaging' ? '公共包装' : '公共供料';
      toast = { text: name + '升至' + result.level + '档，下一轮提速' +
        (savedSuccessfully ? '' : '（未保存）'), at: time, duration: 4 };
      return;
    }
    if (type === 'line-expansion-open') {
      const offer = model.lineExpansionOffer(result.product || result.lineId);
      if (!offer) return;
      lineExpansion = { product: offer.product };
      renderer.lineExpansionProduct = offer.product;
      renderer.lineExpansionDialogOpen = true;
      upgradeDialog = false;
      renderer.upgradeDialogOpen = false;
      closeSharedUpgrade();
      input.cancel();
      return;
    }
    if (type === 'line-expansion-close') {
      closeLineExpansion();
      input.cancel();
      return;
    }
    if (type === 'line-buy') {
      if (platform.cancelInput) platform.cancelInput();
      input.cancel();
      model.selectLine(result.lineId);
      closeLineExpansion();
      if (typeof renderer.focusLine === 'function') renderer.focusLine(result.lineId);
      const savedSuccessfully = save();
      toast = { text: lineName(result.lineId, result.product) + '已建成，库存独立' +
        (savedSuccessfully ? '' : '（未保存）'), at: time, duration: 4 };
      return;
    }
    if (type === 'page') {
      upgradeDialog = false;
      renderer.upgradeDialogOpen = false;
      closeLineExpansion();
      closeSharedUpgrade();
      input.cancel();
    }
    if (type === 'order-focus') {
      if (platform.cancelInput) platform.cancelInput();
      input.cancel();
      save();
      return;
    }
    if (!preferences.reducedMotion && (type === 'launch' || type === 'merge')) effects.push({ type, index: result.to, from: result.from,
      product: result.product, level: result.level, itemId: result.itemId, startedAt: time, duration: type === 'merge' ? .45 : .24 });
    if (type === 'deliver') {
      if (platform.cancelInput) platform.cancelInput();
      input.cancel();
      toast = { text: '交付成功，金币 +' + result.reward + ' · 已服务' + result.customerServiceCount + '次',
        at: time, duration: 2.5 };
      if (!preferences.reducedMotion) (result.consumed || [{ index: result.from }]).forEach(item =>
        effects.push({ type: 'deliver', index: item.index, startedAt: time, duration: .6 }));
    }
    if (type === 'capacity-upgrade') {
      toast = { text: lineName(result.lineId, result.product) + '加工提速，下一批启用', at: time, duration: 3 };
    }
    if (type === 'output-upgrade') {
      if (platform.cancelInput) platform.cancelInput();
      input.cancel();
      toast = { text: lineName(result.lineId, result.product) + '升至 Lv.' + result.level + '，库存折成' + result.inventoryAfter + '份', at: time, duration: 3 };
    }
    save();
  });
  resize();
  platform.onResize(resize);
  platform.onInput({
    start: points => {
      if (!loaded || !session.visible) return;
      if (!entry) {
        if (!session.canInteract) return;
        session.advance();
        if (!session.canInteract) return;
      }
      input.start(points);
    },
    move: points => { if (loaded && session.visible && (entry || session.canInteract)) input.move(points); },
    end: points => {
      if (!loaded || !session.visible) { input.cancel(); return; }
      if (!entry) session.advance();
      if (entry || session.canInteract) input.end(points);
      else input.cancel();
    },
    cancel: () => input.cancel(),
    wheel: deltaY => {
      if (!entry && session.canInteract && model.state.page === 'factory' && !upgradeDialog && !sharedUpgrade && !lineExpansion && !offlineSummary &&
          typeof input.scroll === 'function') input.scroll(deltaY);
    },
  });
  platform.onLifecycle(() => {
    if (platform.cancelInput) platform.cancelInput();
    input.cancel(); session.hide(); lastFrame = null;
  }, () => {
    session.show(); lastFrame = null;
    if (loaded) presentOfflineSummary();
  });
  const loadingScreen = () => {
    const ctx = platform.canvas.getContext('2d');
    ctx.setTransform(platform.pixelRatio, 0, 0, platform.pixelRatio, 0, 0);
    ctx.fillStyle = '#f5eddf'; ctx.fillRect(0, 0, platform.width, platform.height);
    ctx.fillStyle = '#255d56'; ctx.textAlign = 'center'; ctx.font = 'bold 24px sans-serif';
    ctx.fillText('爆米花工坊', platform.width / 2, platform.height / 2 - 28);
    ctx.font = '15px sans-serif';
    ctx.fillText(loadError ? '暂时无法进入，请重新打开游戏' : '正在准备工坊 ' + Math.round(progress * 100) + '%', platform.width / 2, platform.height / 2 + 8);
    if (loadError) { ctx.font = '12px sans-serif'; ctx.fillText('重新打开会保留已保存的进度', platform.width / 2, platform.height / 2 + 38); }
  };
  const frame = timestamp => {
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    const delta = lastFrame == null ? 0 : Math.max((now - lastFrame) / 1000, 0);
    lastFrame = now;
    if (loaded) {
      if (session.ready && session.visible) {
        session.advance(); time += delta;
        // Lifecycle events cancel suspended gestures. A slow visible frame
        // should preserve a valid drag, without replaying a long shot backlog.
        if (!entry && !session.canInteract) input.cancel();
        else if (!entry) input.update(Math.min(delta, 0.1));
        if (time - lastSave >= 2) { save(); lastSave = time; }
      }
      for (let index = effects.length - 1; index >= 0; index--) if (time - effects[index].startedAt > effects[index].duration) effects.splice(index, 1);
      if (toast && time - toast.at > toast.duration) toast = null;
      const expansion = lineExpansion ? { product: lineExpansion.product,
        offer: model.lineExpansionOffer(lineExpansion.product) } : null;
      const bottleneck = model.productionBottleneck();
      const shared = sharedUpgrade ? { focus: sharedUpgrade.focus, bottleneck,
        offers: { supply: model.sharedUpgradeOffer('supply'), packaging: model.sharedUpgradeOffer('packaging') } } : null;
      renderer.draw(model, { time, toast, gesture: input.gesture, effects, upgradeDialog, sharedUpgrade: shared,
        productionBottleneck: bottleneck, lineExpansion: expansion, offlineSummary,
        entry, settingsOpen, reducedMotion: preferences.reducedMotion });
      if (platform.publishState) platform.publishState(model.state, { upgradeDialog, sharedUpgrade: shared,
        productionBottleneck: bottleneck, lineExpansion: expansion, offlineSummary,
        orders: model.state.orders.map(order => model.orderProgress(order.id)),
        customerServiceCount: model.customerServiceCount('rabbit-courier'),
        entry, settingsOpen, reducedMotion: preferences.reducedMotion,
        upgradeOffers: upgradeDialog ? { capacity: model.capacityOffer(), output: model.outputOffer() } : null });
    } else loadingScreen();
    platform.requestFrame(frame);
  };
  assets.load(value => { progress = value; }).then(() => {
    loaded = true;
    session.setReady();
    if (saveReadFailed) toast = { text: '存档读取失败，本轮保留旧存档，请重新进入', at: time, duration: 8 };
    presentOfflineSummary();
  })
    .catch(error => { loadError = error; platform.reportError(error); });
  platform.requestFrame(frame);
  return { model, renderer, input, assets, platform, session };
}

module.exports = { startGame };
