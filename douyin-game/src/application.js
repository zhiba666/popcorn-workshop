'use strict';

const { createPlatform } = require('./platform');
const { Assets } = require('./assets');
const { SaveRecovery } = require('./save-recovery');
const { Renderer, OFFLINE_PAGE_SIZE } = require('./renderer');
const { Input } = require('./input');
const { ProductionSession, mergeOfflineSummary } = require('./production-session');
const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS } = require('./production-config');
const { getCustomer } = require('./customer-config');
const { FactoryPresentation } = require('./factory-presentation');
const { BoardController } = require('./board-controller');

const productName = product => PRODUCT_DEFINITIONS[product]?.name || '产品';
const workshopName = product => PRODUCT_DEFINITIONS[product]?.workshopName || '新工坊';

function recoveryView(issue, confirm = false, message = '') {
  return {
    reason: issue.reason, confirm, message,
    title: confirm ? '确认重新开始？' : '存档需要恢复',
    lines: confirm ? ['将从初始工坊重新开始。', '旧存档会先备份到本机，', '再用新存档替换当前进度。'] :
      [issue.reason === 'read-failed' ? '暂时无法读取本机存档。' : '当前存档暂时无法使用。',
        '原存档已保留，游戏进度已暂停。', '请重试读取，或选择重新开始。'],
  };
}

function startGame() {
  const platform = createPlatform();
  const saveRecovery = new SaveRecovery(platform);
  let model = saveRecovery.model;
  if (saveRecovery.issue?.error) platform.reportError(saveRecovery.issue.error);
  const assets = new Assets(platform);
  const renderer = new Renderer(platform.canvas, assets);
  const boardController = new BoardController(() => model);
  renderer.boardFlow = boardController.flow;
  const factoryPresentation = new FactoryPresentation();
  let factoryFeedback = { construction: null, packaging: null };
  let preferences = { reducedMotion: false };
  try {
    const savedPreferences = platform.readPreferences();
    preferences.reducedMotion = !!(savedPreferences && savedPreferences.reducedMotion === true);
  } catch (error) { platform.reportError(error); }
  let time = 0, lastFrame = null, loaded = false, progress = 0,
    lastSave = 0, toast = null, loadError = null, storageErrorReported = false, pickupSavePending = false,
    upgradeDialog = false, sharedUpgrade = null, lineExpansion = null, productConstruction = null,
    offlineSummary = null, offlinePage = 0, entry = true, settingsOpen = false,
    recovery = saveRecovery.issue ? recoveryView(saveRecovery.issue) : null,
    customerResponse = null;
  const effects = [];
  const lineName = (lineId, product) => {
    const line = model.getLine(lineId);
    const number = String(lineId || '').match(/-(\d+)$/);
    const kind = product || (line && line.product);
    return productName(kind) + (number ? number[1] : '') + '号线';
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
  const closeProductConstruction = () => {
    productConstruction = null;
    renderer.productConstructionDialogOpen = false;
    renderer.productConstructionProduct = null;
  };
  const createSession = () => new ProductionSession({
    model, now: () => platform.now(), writeSave: value => platform.writeSave(value),
    onProduced: result => factoryPresentation.observeProduction(result, time),
    canWrite: !saveRecovery.issue, isVisible: platform.isVisible,
    onSaveError(error) {
      if (!storageErrorReported) {
        toast = { text: '存档失败，请检查设备存储空间', at: time, duration: 5 };
        platform.reportError(error); storageErrorReported = true;
      }
    },
    onSaveSuccess() {
      pickupSavePending = false;
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
  let session = createSession();
  const showRecovery = (confirm, message = '') => {
    input.cancel();
    recovery = recoveryView(saveRecovery.issue, confirm, message);
    renderer.recovery = recovery;
  };
  const resumeRecovered = (result, message) => {
    if (platform.cancelInput) platform.cancelInput();
    input.cancel();
    model = result.model;
    pickupSavePending = false;
    boardController.reset();
    input.model = model;
    recovery = null;
    renderer.recovery = null;
    entry = true; settingsOpen = false;
    renderer.entryOpen = true; renderer.entrySettingsOpen = false;
    upgradeDialog = false; renderer.upgradeDialogOpen = false;
    closeLineExpansion(); closeSharedUpgrade(); closeProductConstruction();
    offlineSummary = null; offlinePage = 0; renderer.offlineSummaryOpen = false;
    effects.length = 0;
    factoryPresentation.clear();
    factoryFeedback = { construction: null, packaging: null };
    customerResponse = null;
    renderer.customerSelectedId = null;
    renderer.customerScroll = 0;
    renderer.customerCollectionScroll = 0;
    renderer.customerBubbleOpen = false;
    storageErrorReported = false;
    toast = { text: message, at: time, duration: 4 };
    session = createSession();
    if (loaded) session.setReady();
    lastFrame = null; lastSave = time;
  };
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
    const stockText = summary.producedByLine.map(item =>
      lineName(item.lineId, item.product) + item.level + '级' + item.units + '份').join('、');
    if (summary.seconds >= 60 || offlineSummary || summary.producedByLine.length > 2 || stockText.length > 24 || summary.firstStockedProducts?.length || summary.saveFailed) {
      offlineSummary = summary;
      offlinePage = 0;
      upgradeDialog = false;
      renderer.upgradeDialogOpen = false;
      closeLineExpansion();
      closeSharedUpgrade();
      closeProductConstruction();
      renderer.offlineSummaryOpen = true;
      input.cancel();
    } else {
      toast = { text: '离线入库：' + stockText + (summary.saveFailed ? '（未保存）' : ''), at: time, duration: 5 };
    }
  };
  const presentFirstStockedProducts = () => {
    if (entry || !session.visible || !session.ready || offlineSummary || upgradeDialog || sharedUpgrade || lineExpansion || productConstruction || toast) return;
    const products = session.takeFirstStockedProducts();
    if (!products.length) return;
    const savedSuccessfully = session.checkpoint();
    if (products.length === 1 && products[0] === factoryFeedback.construction?.product &&
        factoryFeedback.construction.completed && savedSuccessfully) return;
    const name = products.length === 1 ? productName(products[0]) : products.length + '种产品';
    toast = { text: name + '首批已入库，去棋盘发射取货' + (savedSuccessfully ? '' : '（未保存）'), at: time, duration: 5 };
  };
  const resize = () => {
    platform.canvas.width = Math.max(1, Math.round(platform.width * platform.pixelRatio));
    platform.canvas.height = Math.max(1, Math.round(platform.height * platform.pixelRatio));
    renderer.setViewport(platform.width, platform.height, platform.safeTop, platform.safeBottom, platform.menuBounds);
    if (platform.cancelInput) platform.cancelInput();
    input.cancel();
  };
  const reasons = {
    'empty-inventory': '等待产线入库，补货后重新按下取货', 'board-full': '棋盘已满，腾位后重新按下取货',
    'nothing-to-restore': '暂无可恢复的丢弃商品',
    incompatible: '同种同级的商品才能合成', 'max-level': '商品已达最高 Lv.' + CONFIG.maxProductLevel,
    'order-not-ready': '先备齐订单所需的棋盘成品', 'launcher-protected': '发射器需要留在棋盘上',
    'order-not-found': '这张订单已更新，请查看当前订单',
    'order-edge': '已到订单列表边缘',
    'super-order-unavailable': '先投产超级订单所需的产品',
    'super-orders-complete': '这位顾客的超级订单已全部完成',
    'super-orders-unconfigured': '超级订单尚未开放',
    'insufficient-coins': '金币不足，完成订单后再来升级', 'capacity-max': '本线产能已满',
    'output-max': '出厂等级已达最高 Lv.' + CONFIG.maxOutputLevel,
    'not-processing': '本批进入加工后可加速',
    'waiting-supply': '等待公共供料，备料后自动开始',
    'waiting-packaging': '等待公共包装，腾出位置后自动继续',
    'waiting-cache': '本线缓存已满，包装腾出位置后自动继续',
    'numeric-limit': '已达到当前可存储的数量上限',
    'line-max': '本产品流水线已达本轮上限',
    'invalid-product': '请选择已开放产品的流水线',
    'shared-max': '本轮公共设备已达最高档',
    'invalid-service': '请选择公共供料或公共包装',
    'product-not-built': '请先建设这个产品的首条流水线',
    'product-built': '该工坊已建成，可通过扩线增加产线',
    'previous-product-required': '请先建设上一代工坊',
  };
  const input = new Input(model, renderer, function handleAction(result) {
    const outcome = boardController.handle(result, time);
    if (outcome) {
      if (result.action !== 'board-pickup-end') {
        if (platform.cancelInput) platform.cancelInput();
        input.cancel();
      }
      if (outcome.result) handleAction(outcome.result);
      if (outcome.save || (result.action === 'board-pickup-end' && result.count > 0 && pickupSavePending)) save();
      if (outcome.message && !storageErrorReported) toast = { text: outcome.message, at: time, duration: 3 };
      return;
    }
    boardController.observe(result, time);
    if (platform.kind === 'browser') console.debug('[工坊操作]', JSON.stringify(result));
    if (!result.ok) {
      let text = reasons[result.reason] || '请拖到空格或相同等级的商品';
      if (result.action === 'line-buy') {
        const offer = model.lineExpansionOffer(result.product);
        const name = productName(result.product);
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
      if (result.action === 'product-build') {
        const offer = model.productConstructionOffer(result.product);
        if (result.reason === 'board-full') text = '棋盘需腾出一格，用于' + productName(result.product) + '发射器';
        if (result.reason === 'insufficient-coins' && offer) text = '建设' + workshopName(result.product) + '还差' + Math.max(0, offer.cost - model.state.coins) + '金币';
      }
      toast = { text, at: time, duration: 2.5 };
      return;
    }
    const type = result.action;
    if (type === 'factory-dock-toggle') {
      input.cancel();
      renderer.factoryDockExpanded = !renderer.factoryDockExpanded;
      renderer.configureFactoryViewport();
      return;
    }
    if (type === 'factory-order-open' || type === 'factory-order-close') {
      input.cancel();
      renderer.factoryOrderExpanded = type === 'factory-order-open';
      return;
    }
    if (type === 'factory-home') {
      input.cancel();
      renderer.factoryFollowCancelled = true;
      renderer.factoryServiceFocus = null;
      renderer.focusFactoryRect(renderer.factoryLayout?.scenes.find(scene => scene.lineId === model.state.selectedLineId)?.hit, false, 1);
      return;
    }
    if (type === 'factory-view-toggle') {
      input.cancel();
      renderer.factoryFollowCancelled = true;
      renderer.pendingFactoryServiceFocus = null;
      renderer.factoryViewMode = result.mode === 'overview' ? 'overview' : 'detail';
      return;
    }
    if (type === 'factory-focus') {
      input.cancel();
      renderer.factoryViewMode = 'detail';
      renderer.factoryFollowCancelled = true;
      renderer.factoryServiceFocus = result.service;
      renderer.pendingFactoryServiceFocus = result.service;
      return;
    }
    if (type === 'select-line') {
      input.cancel();
      renderer.factoryViewMode = 'detail';
      if (!renderer.factoryDockExpanded) {
        renderer.factoryDockExpanded = true;
        renderer.configureFactoryViewport();
      }
      renderer.factoryServiceFocus = null;
      renderer.factoryFollowCancelled = true;
      renderer.focusLine(result.lineId);
      save();
      return;
    }
    if (type === 'upgrade-tab' || type === 'upgrade-details') {
      input.cancel();
      renderer.capacityBuyEnabled = false;
      renderer.outputBuyEnabled = false;
      if (type === 'upgrade-tab') { renderer.upgradeTab = result.tab; renderer.upgradeDetailsOpen = false; }
      else renderer.upgradeDetailsOpen = !renderer.upgradeDetailsOpen;
      return;
    }
    if (type.startsWith('entry-recovery-')) {
      if (!recovery) return;
      if (type === 'entry-recovery-new' && !recovery.confirm) showRecovery(true);
      else if (type === 'entry-recovery-cancel' && recovery.confirm) showRecovery(false);
      else if (type === 'entry-recovery-retry' && !recovery.confirm) {
        const retried = saveRecovery.retry();
        if (retried.ok) resumeRecovered(retried, '存档已重新读取，可以继续经营');
        else {
          if (retried.issue.error) platform.reportError(retried.issue.error);
          showRecovery(false, '仍无法读取，原存档继续保留');
        }
      } else if (type === 'entry-recovery-confirm' && recovery.confirm) {
        const restarted = saveRecovery.restart();
        if (restarted.ok) resumeRecovered(restarted, '旧档已备份，新工坊已保存');
        else {
          if (restarted.issue.error) platform.reportError(restarted.issue.error);
          showRecovery(true, restarted.issue.reason === 'write-failed' ?
            '新档保存失败，旧档备份已保留' : '旧档备份失败，尚未开始新游戏');
        }
      }
      return;
    }
    if (recovery) return;
    if (type.startsWith('customer-')) {
      if (type === 'customer-response-close') customerResponse = null;
      else if (type === 'customer-open' || type === 'customer-select') {
        const info = model.customerInfo(result.customerId);
        if (!info) return;
        renderer.customerReturnPage = type === 'customer-open' ? model.state.page : 'customers';
        if (type === 'customer-select') renderer.customerCollectionScroll = renderer.customerScroll;
        renderer.customerSelectedId = result.customerId;
        renderer.customerScroll = 0;
        renderer.customerBubbleOpen = false;
        renderer.customerRecordExpanded = Object.create(null);
        customerResponse = null;
        model.setPage('customers');
        model.markCustomerRead(result.customerId);
        save();
      } else if (type === 'customer-back') {
        renderer.customerSelectedId = null;
        renderer.customerBubbleOpen = false;
        renderer.customerScroll = renderer.customerCollectionScroll || 0;
        model.setPage(renderer.customerReturnPage || 'customers');
        save();
      } else if (type === 'customer-talk') renderer.customerBubbleOpen = true;
      else if (type === 'customer-bubble-close') renderer.customerBubbleOpen = false;
      else if (type === 'customer-record-toggle') {
        renderer.customerRecordExpanded[result.recordKey] = !result.expanded;
      } else if (type === 'customer-super-order' || type === 'customer-super-pause') {
        const tracked = model.trackSuperOrder(type === 'customer-super-pause' ? null : result.customerId);
        if (tracked.ok) {
          if (type === 'customer-super-order') model.setPage('board');
          renderer.customerBubbleOpen = false;
          save();
        } else toast = { text: reasons[tracked.reason] || '这张超级订单暂未开放', at: time, duration: 3 };
      } else if (type === 'customer-orders') {
        const customerId = result.customerId || renderer.customerSelectedId;
        const current = model.getOrder();
        const order = current?.customerId === customerId && current.kind !== 'super' ? current :
          model.state.orders.find(item => item.customerId === customerId && item.id === renderer.customerLastOrders?.[customerId]) ||
          model.state.orders.find(item => item.customerId === customerId);
        if (order) { model.focusOrder(order.id); model.setPage('board'); save(); }
        renderer.customerBubbleOpen = false;
      }
      input.cancel();
      return;
    }
    if (type === 'entry-enter') {
      entry = false; settingsOpen = false;
      renderer.entryOpen = false; renderer.entrySettingsOpen = false;
      input.cancel();
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
      offlinePage = 0;
      renderer.offlineSummaryOpen = false;
      return;
    }
    if (type === 'offline-prev' || type === 'offline-next') {
      if (!offlineSummary || result.page !== offlinePage) return;
      const pageCount = Math.max(1, Math.ceil(offlineSummary.producedByLine.length / OFFLINE_PAGE_SIZE));
      offlinePage = Math.max(0, Math.min(pageCount - 1, offlinePage + (type === 'offline-next' ? 1 : -1)));
      input.cancel();
      return;
    }
    if (type === 'upgrade-open' || type === 'upgrade-close') {
      upgradeDialog = type === 'upgrade-open';
      renderer.upgradeDialogOpen = upgradeDialog;
      if (upgradeDialog) { renderer.upgradeDetailsOpen = false; closeLineExpansion(); closeSharedUpgrade(); closeProductConstruction(); }
      input.cancel();
      return;
    }
    if (type === 'shared-upgrade-open') {
      sharedUpgrade = { focus: ['supply', 'packaging'].includes(result.service) ? result.service : null };
      renderer.sharedUpgradeDialogOpen = true;
      upgradeDialog = false;
      renderer.upgradeDialogOpen = false;
      closeLineExpansion();
      closeProductConstruction();
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
      if (result.service === 'packaging') {
        factoryPresentation.startPackaging(model, time);
        closeSharedUpgrade();
        renderer.pendingFactoryServiceFocus = 'packaging';
        renderer.factoryFollowCancelled = false;
      }
      const savedSuccessfully = save();
      const name = result.service === 'packaging' ? '公共包装' : '公共供料';
      toast = { text: name + '升至' + result.level + '档，下一轮提速' +
        (savedSuccessfully ? '' : '（未保存）'), at: time, duration: 4 };
      if (result.service === 'packaging' && savedSuccessfully) toast = null;
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
      closeProductConstruction();
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
      renderer.factoryViewMode = 'detail';
      renderer.factoryServiceFocus = null;
      factoryPresentation.startConstruction(model, result.lineId, time);
      renderer.factoryFollowCancelled = false;
      if (typeof renderer.focusLine === 'function') renderer.focusLine(result.lineId);
      const savedSuccessfully = save();
      toast = { text: lineName(result.lineId, result.product) + '已建成，库存独立' +
        (savedSuccessfully ? '' : '（未保存）'), at: time, duration: 4 };
      if (savedSuccessfully) toast = null;
      return;
    }
    if (type === 'product-construction-open') {
      const offer = model.productConstructionOffer(result.product);
      if (!offer || model.productStage(result.product) !== 'unbuilt') return;
      productConstruction = { product: offer.product };
      renderer.productConstructionProduct = offer.product;
      renderer.productConstructionDialogOpen = true;
      upgradeDialog = false;
      renderer.upgradeDialogOpen = false;
      closeLineExpansion();
      closeSharedUpgrade();
      input.cancel();
      return;
    }
    if (type === 'product-construction-close') {
      closeProductConstruction();
      input.cancel();
      return;
    }
    if (type === 'product-build') {
      if (platform.cancelInput) platform.cancelInput();
      input.cancel();
      model.selectLine(result.lineId);
      closeProductConstruction();
      renderer.factoryViewMode = 'detail';
      renderer.factoryServiceFocus = null;
      factoryPresentation.startConstruction(model, result.lineId, time);
      renderer.factoryFollowCancelled = false;
      renderer.focusLine(result.lineId);
      const savedSuccessfully = save();
      toast = { text: workshopName(result.product) + '已建成，首批自动生产中' + (savedSuccessfully ? '' : '（未保存）'), at: time, duration: 4 };
      if (savedSuccessfully) toast = null;
      return;
    }
    if (type === 'page') {
      renderer.factoryFollowCancelled = true;
      if (renderer.page === 'customers' && !renderer.customerSelectedId) renderer.customerCollectionScroll = renderer.customerScroll;
      upgradeDialog = false;
      renderer.upgradeDialogOpen = false;
      closeLineExpansion();
      closeSharedUpgrade();
      closeProductConstruction();
      customerResponse = null;
      renderer.customerBubbleOpen = false;
      if (model.state.page === 'customers') {
        renderer.customerSelectedId = null;
        renderer.customerScroll = renderer.customerCollectionScroll || 0;
      }
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
      const customer = getCustomer(result.customerId);
      const services = result.customerServiceCount, completed = model.customerInfo(customer.id).superOrdersCompleted || 0;
      const stage = customer.stages.filter(item => item.superOrders <= completed).slice(-1)[0];
      customerResponse = { customerId: customer.id, reward: result.reward,
        text: (services === 1 ? '已结识。' : '') + (stage?.reply || '谢谢，这份我带走啦。'),
        kind: services === 1 ? '初次结识' : '普通交单',
        startedAt: time, duration: 5 };
      toast = { text: '订单收入 +' + result.reward + (services === 1 ? ' · 已结识' + customer.name :
        ' · 累计服务' + services + '次'), at: time, duration: 3 };
      if (!preferences.reducedMotion) (result.consumed || [{ index: result.from }]).forEach(item =>
        effects.push({ type: 'deliver', index: item.index, startedAt: time, duration: .6 }));
    }
    if (type === 'restore-discard') toast = { text: productName(result.product) + ' Lv.' + result.level + '已恢复', at: time, duration: 3 };
    if (type === 'discard') toast = { text: '已丢弃，可恢复最近丢弃的一件', at: time, duration: 3 };
    if (type === 'capacity-upgrade') {
      toast = { text: lineName(result.lineId, result.product) + '加工提速，下一批启用', at: time, duration: 3 };
    }
    if (type === 'output-upgrade') {
      if (platform.cancelInput) platform.cancelInput();
      input.cancel();
      toast = { text: lineName(result.lineId, result.product) + '升至 Lv.' + result.level + '，库存折成' + result.inventoryAfter + '份', at: time, duration: 3 };
    }
    if (type === 'launch') {
      pickupSavePending = true;
      // Continuous fire checkpoints on release, automatic stop or the regular
      // save interval, instead of blocking every shot on synchronous storage.
      if (result.longPress && !result.pickupStopped) return;
    }
    save();
  }, () => platform.now());
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
    end: (points, activePoints) => {
      if (!loaded || !session.visible) { input.cancel(); return; }
      if (!entry) session.advance();
      if (entry || session.canInteract) input.end(points, activePoints);
      else input.cancel();
    },
    cancel: () => input.cancel(),
    wheel: (deltaY, points, modifiers) => {
      if (!entry && session.canInteract && (['factory', 'customers'].includes(model.state.page) || boardController.flow.mode) && !upgradeDialog && !sharedUpgrade && !lineExpansion && !productConstruction && !offlineSummary &&
          typeof input.scroll === 'function') return input.scroll(deltaY, points, modifiers);
      return false;
    },
  });
  platform.onLifecycle(() => {
    if (platform.cancelInput) platform.cancelInput();
    input.cancel(); session.hide(); lastFrame = null;
    factoryPresentation.clear();
    factoryFeedback = { construction: null, packaging: null };
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
      if (session.visible) time += delta;
      if (session.ready && session.visible) {
        session.advance();
        // Lifecycle events cancel suspended gestures. A slow visible frame
        // should preserve a valid drag, without replaying a long shot backlog.
        if (!entry && !session.canInteract) input.cancel();
        else if (!entry) input.update(Math.min(delta, 0.1));
        if (time - lastSave >= 2) { save(); lastSave = time; }
      }
      for (let index = effects.length - 1; index >= 0; index--) if (time - effects[index].startedAt > effects[index].duration) effects.splice(index, 1);
      if (toast && time - toast.at > toast.duration) toast = null;
      if (customerResponse && time - customerResponse.startedAt > customerResponse.duration) customerResponse = null;
      factoryFeedback = factoryPresentation.update(model, time);
      presentFirstStockedProducts();
      const expansion = lineExpansion ? { product: lineExpansion.product,
        offer: model.lineExpansionOffer(lineExpansion.product) } : null;
      const construction = productConstruction ? { product: productConstruction.product,
        offer: model.productConstructionOffer(productConstruction.product) } : null;
      const bottleneck = model.productionBottleneck();
      const shared = sharedUpgrade ? { focus: sharedUpgrade.focus, bottleneck,
        offers: { supply: model.sharedUpgradeOffer('supply'), packaging: model.sharedUpgradeOffer('packaging') } } : null;
      renderer.draw(model, { time, delta: Math.min(delta, 0.1), toast, gesture: input.gesture, effects, upgradeDialog, sharedUpgrade: shared,
        factoryPresentation: factoryFeedback,
        productionBottleneck: bottleneck, lineExpansion: expansion, productConstruction: construction, offlineSummary, offlinePage,
        customerResponse, entry, settingsOpen, recovery, reducedMotion: preferences.reducedMotion });
      if (platform.publishState) platform.publishState(model.state, { upgradeDialog, sharedUpgrade: shared,
        factoryViewMode: renderer.factoryViewMode, factoryServiceFocus: renderer.factoryServiceFocus,
        factoryCamera: { x: renderer.factoryCamera.x, y: renderer.factoryCamera.y, zoom: renderer.factoryCamera.zoom },
        factoryDockExpanded: renderer.factoryDockExpanded, factoryOrderExpanded: renderer.factoryOrderExpanded,
        upgradeTab: renderer.upgradeTab, upgradeDetailsOpen: renderer.upgradeDetailsOpen,
        factoryPresentation: factoryFeedback,
        productionBottleneck: bottleneck, lineExpansion: expansion, productConstruction: construction, offlineSummary,
        offlinePagination: offlineSummary ? { page: offlinePage, pageSize: OFFLINE_PAGE_SIZE,
          pageCount: Math.max(1, Math.ceil(offlineSummary.producedByLine.length / OFFLINE_PAGE_SIZE)) } : null,
        orders: model.getOrders().map(order => model.orderProgress(order.id)),
        boardFlowDescription: boardController.describe(),
        customerServiceCount: model.customerServiceCount('rabbit-courier'),
        customers: model.customerCollection(), selectedCustomerId: renderer.customerSelectedId,
        customerBubbleOpen: renderer.customerBubbleOpen, customerResponse,
        entry, settingsOpen, recovery, reducedMotion: preferences.reducedMotion,
        upgradeOffers: upgradeDialog ? { capacity: model.capacityOffer(), output: model.outputOffer() } : null });
    } else loadingScreen();
    platform.requestFrame(frame);
  };
  assets.load(value => { progress = value; }).then(() => {
    loaded = true;
    if (!recovery) session.setReady();
    presentOfflineSummary();
  })
    .catch(error => { loadError = error; platform.reportError(error); });
  platform.requestFrame(frame);
  return { get model() { return model; }, get session() { return session; }, renderer, input, assets, platform, boardController };
}

module.exports = { startGame };
