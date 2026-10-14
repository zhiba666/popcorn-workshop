'use strict';

const SAVE_KEY = 'popcorn-dual-product-v4';
const LEGACY_SAVE_KEY = 'popcorn-original-single-line-v1';
const PREFERENCES_KEY = 'popcorn-ui-settings-v1';

function createPlatform() {
  if (typeof tt !== 'undefined') return createDouyinPlatform(tt);
  if (typeof document !== 'undefined') return createBrowserPlatform();
  throw new Error('请在抖音开发者工具或浏览器预览中运行。');
}

function createDouyinPlatform(api) {
  const canvas = api.createCanvas();
  const info = api.getSystemInfoSync();
  const readMenuBounds = () => {
    if (typeof api.getMenuButtonLayout !== 'function') return null;
    try {
      const bounds = api.getMenuButtonLayout();
      return bounds && [bounds.left, bounds.right, bounds.bottom].every(Number.isFinite) ? bounds : null;
    } catch (error) { return null; }
  };
  const platform = {
    canvas, kind: 'douyin', isVisible: true,
    width: info.windowWidth || info.screenWidth,
    height: info.windowHeight || info.screenHeight,
    pixelRatio: Math.min(info.pixelRatio || 1, 2),
    safeTop: Math.max(0, info.safeArea ? info.safeArea.top : 0),
    safeBottom: Math.max(0, info.safeArea ? info.screenHeight - info.safeArea.bottom : 0),
    menuBounds: readMenuBounds(),
    createImage: () => api.createImage(),
    now: () => Date.now(),
    requestFrame: callback => requestAnimationFrame(callback),
    readSave() {
      const information = api.getStorageInfoSync();
      const key = information.keys.includes(SAVE_KEY) ? SAVE_KEY :
        information.keys.includes(LEGACY_SAVE_KEY) ? LEGACY_SAVE_KEY : null;
      if (!key) return null;
      const value = api.getStorageSync(key);
      if (value == null) throw new Error('已有存档内容为空');
      return value;
    },
    writeSave(value) { api.setStorageSync(SAVE_KEY, value); },
    readPreferences() { return api.getStorageSync(PREFERENCES_KEY) || null; },
    writePreferences(value) { api.setStorageSync(PREFERENCES_KEY, { reducedMotion: value.reducedMotion === true }); },
    onInput(handlers) {
      api.onTouchStart(event => handlers.start(event.changedTouches || event.touches));
      api.onTouchMove(event => handlers.move(event.changedTouches || event.touches));
      api.onTouchEnd(event => handlers.end(event.changedTouches || []));
      api.onTouchCancel(() => handlers.cancel());
    },
    onLifecycle(hide, show) {
      api.onHide(() => { platform.isVisible = false; hide(); });
      api.onShow(() => { platform.isVisible = true; show(); });
    },
    onResize(callback) {
      if (!api.onWindowResize) return;
      api.onWindowResize(event => {
        const next = api.getSystemInfoSync();
        platform.width = event.windowWidth || next.windowWidth;
        platform.height = event.windowHeight || next.windowHeight;
        platform.safeTop = Math.max(0, next.safeArea ? next.safeArea.top : 0);
        platform.safeBottom = Math.max(0, next.safeArea ? next.screenHeight - next.safeArea.bottom : 0);
        platform.menuBounds = readMenuBounds();
        callback();
      });
    },
    reportError(error) { console.error('[爆米花工坊]', error); },
  };
  return platform;
}

function createBrowserPlatform() {
  const canvas = document.getElementById('game-canvas');
  let publishedLabel = null;
  const platform = {
    canvas, kind: 'browser', width: 390, height: 844, isVisible: !document.hidden,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2), safeTop: 0, safeBottom: 0,
    createImage: () => new Image(),
    now: () => Date.now(),
    publishState(state, ui) {
      const screen = ui && ui.entry ? 'entry' : state.page;
      canvas.setAttribute('data-screen', screen);
      canvas.setAttribute('data-reduced-motion', String(!!(ui && ui.reducedMotion)));
      if (ui && ui.entry) {
        const label = '爆米花工坊，游戏入口，进入游戏。' + (ui.settingsOpen ?
          '设置已打开，减少动效' + (ui.reducedMotion ? '已开启' : '已关闭') + '，关闭设置。' : '打开设置。');
        if (label !== publishedLabel) { canvas.setAttribute('aria-label', label); publishedLabel = label; }
        return;
      }
      const productName = id => id === 'caramel' ? '焦糖' : '原味';
      const lineName = (id, product) => {
        const line = state.lines.find(candidate => candidate.id === id);
        const number = String(id || '').match(/-(\d+)$/);
        return productName(product || (line && line.product)) + (number ? number[1] : '') + '号线';
      };
      const occupied = state.board.map((item, index) => {
        if (!item) return '';
        const description = item.kind === 'launcher' ? lineName(item.lineId, item.product) + 'Lv.' + item.level + '发射器' :
          productName(item.product) + item.level + '级';
        return '第' + (index + 1) + '格' + description;
      }).filter(Boolean).join('，');
      const batchDescription = batch => 'Lv.' + batch.outputLevel + '共' + batch.batchUnits + '份';
      const lines = state.lines.map(line => {
        const buffer = line.buffer || [], warehouse = line.warehouse || [], legacy = line.legacyGroup;
        const cacheUnits = buffer.reduce((sum, batch) => sum + batch.baseUnits, 0);
        const oldBatches = legacy ? '，旧批待包装' + legacy.batchIds.length + '批，已包待统一折算' +
          legacy.completedBatches.length + '批共' + legacy.completedBaseUnits + '一级材料等价量' : '，无待结算旧批';
        return lineName(line.id, line.product) + '（' + line.id + '）库存' + line.inventory + '，出厂Lv.' + line.outputLevel +
          '，产能' + line.capacityLevel + '档，当前加工批' + batchDescription(line.factory) +
          '，工序' + line.factory.phase + '，缓存' + buffer.length + '批占' + cacheUnits +
          (line.cacheCapacityBaseUnits == null ? '' : '/' + line.cacheCapacityBaseUnits) + '一级材料等价量' +
          (buffer.length ? '（' + buffer.map(batchDescription).join('、') + '）' : '') + oldBatches +
          '，包装后转运' + warehouse.length + '批' + (warehouse.length ? '（' + warehouse.map(batch =>
            batchDescription(batch) + (batch.credited ? '记账已处理' : '待入库')).join('、') + '）' : '') +
          '，舍弃一级材料' + line.discardedBaseUnits + '份';
      }).join('；');
      const packaging = state.shared && state.shared.packaging;
      const supply = state.shared && state.shared.supply;
      const sharedState = supply ? '，公共供料' + supply.level + '档，备料周期' + state.shared.materials.duration + '秒' : '';
      const packagingState = packaging ? '，公共包装' + packaging.level + '档，' + (packaging.batch ?
        '正在处理' + lineName(packaging.lineId) + batchDescription(packaging.batch) : '空闲') +
        '，包装队列' + packaging.queue.length + '条线' : '';
      const orders = state.orders || [state.order];
      const orderStatuses = { ready: '棋盘齐货可手动交付', 'materials-ready': '材料够，待发射合成',
        'missing-materials': '继续生产备料' };
      const orderDescription = orders.map((order, index) => {
        const progress = ui && ui.orders && ui.orders.find(item => item.orderId === order.id);
        const requirements = order.requirements.map(item => {
          const found = state.board.some(piece => piece && piece.kind === 'product' &&
            piece.product === item.product && piece.level === item.level);
          return productName(item.product) + item.level + '级一份，棋盘' + (found ? '1/1' : '0/1');
        }).join('、');
        return '第' + (index + 1) + '张订单' + order.id + (order.id === state.focusedOrderId ? '（当前关注）' : '') +
          '需要' + requirements + '，奖励' + order.reward + (progress ? '，' + orderStatuses[progress.status] : '');
      }).join('；');
      const services = ui && ui.customerServiceCount;
      const customerDescription = services == null ? '' : '，兔快递员累计服务' + services + '次';
      const offline = ui && ui.offlineSummary;
      const returnedStock = offline ? '，离线入库' + offline.producedByLine.map(item =>
        lineName(item.lineId, item.product) + 'Lv.' + item.level + '新增' + item.units + '份').join('、') +
        (offline.capped ? '，每次离开最多结算两小时' : '') + (offline.saveFailed ? '，尚未保存' : '，已保存') : '';
      const upgradeOffers = ui && ui.upgradeOffers;
      const describeUpgrade = (name, offer) => name + (offer.maxed ? '已满级' :
        '费用' + offer.cost + '金币，' + (offer.affordable ? '可以升级' : '金币不足'));
      const upgrade = ui && ui.upgradeDialog ? '，' + lineName(state.selectedLineId) + '统一升级面板已打开' + (upgradeOffers ?
        '，' + describeUpgrade('提升产能', upgradeOffers.capacity) + '，' + describeUpgrade('出厂升阶', upgradeOffers.output) : '') : '';
      const sharedUpgrade = ui && ui.sharedUpgrade;
      const describeShared = (name, offer) => describeUpgrade(name, offer) + '，当前' + offer.level + '档，' +
        offer.currentSeconds + '秒' + (offer.maxed ? '' : '，升后' + offer.nextSeconds + '秒') +
        (offer.pending ? '，进行中旧周期完成后提速' : '，服务于全厂');
      const sharedDescription = sharedUpgrade ? '，公共设备升级面板已打开，' +
        describeShared('公共供料', sharedUpgrade.offers.supply) + '，' +
        describeShared('公共包装', sharedUpgrade.offers.packaging) : '';
      const bottleneck = ui && ui.productionBottleneck;
      const bottleneckDescription = bottleneck ? '，生产提示：' + bottleneck.text : '';
      const expansion = ui && ui.lineExpansion;
      const offer = expansion && expansion.offer;
      const expansionReasons = { 'line-max': '已达本轮上限', 'board-full': '棋盘无空格',
        'insufficient-coins': '金币不足', 'numeric-limit': '已达可保存数量上限' };
      const expansionStatus = offer ? (offer.canBuy ? '可以购买' : expansionReasons[offer.reason] || '暂不能购买') : '';
      const expansionDescription = expansion ? '，新增' + productName(expansion.product) + '流水线面板已打开' +
        (offer ? '，当前' + offer.lineCount + '条，最多' + offer.maxLines + '条，费用' + offer.cost +
          '金币，' + expansionStatus + '，新线独立库存且一级起步' : '') : '';
      const label = '爆米花工坊，' + (state.page === 'board' ? '棋盘' : '工厂') + '页，金币' + state.coins +
        '，已交付' + state.completedOrders + '单，并行订单' + orders.length + '张，左右滑动切换关注。' +
        orderDescription + customerDescription +
        '，当前选线' + lineName(state.selectedLineId) + '（' + state.selectedLineId + '）。' + lines + sharedState + packagingState +
        upgrade + sharedDescription + bottleneckDescription + expansionDescription + returnedStock + '。' + occupied;
      if (label !== publishedLabel) {
        canvas.setAttribute('aria-label', label);
        publishedLabel = label;
      }
    },
    requestFrame: callback => window.requestAnimationFrame(callback),
    readSave() {
      const current = window.localStorage.getItem(SAVE_KEY);
      const value = current === null ? window.localStorage.getItem(LEGACY_SAVE_KEY) : current;
      if (value === null) return null;
      const saved = JSON.parse(value);
      if (saved === null) throw new Error('已有存档内容为空');
      return saved;
    },
    writeSave(value) { window.localStorage.setItem(SAVE_KEY, JSON.stringify(value)); },
    readPreferences() {
      const value = window.localStorage.getItem(PREFERENCES_KEY);
      return value === null ? null : JSON.parse(value);
    },
    writePreferences(value) { window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ reducedMotion: value.reducedMotion === true })); },
    onInput(handlers) {
      let activePointer = null;
      const point = event => {
        const rect = canvas.getBoundingClientRect();
        return [{ identifier: event.pointerId, clientX: (event.clientX - rect.left) * platform.width / rect.width,
          clientY: (event.clientY - rect.top) * platform.height / rect.height }];
      };
      canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || activePointer !== null) return;
        activePointer = event.pointerId;
        event.preventDefault(); canvas.setPointerCapture(event.pointerId); handlers.start(point(event));
      });
      canvas.addEventListener('pointermove', event => { if (event.pointerId !== activePointer) return; event.preventDefault(); handlers.move(point(event)); });
      canvas.addEventListener('pointerup', event => { if (event.pointerId !== activePointer) return; event.preventDefault(); handlers.end(point(event));
        activePointer = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); });
      const cancel = event => {
        if (event && event.pointerId !== activePointer) return;
        const pointer = activePointer; activePointer = null;
        if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
        handlers.cancel();
      };
      platform.cancelInput = () => cancel();
      canvas.addEventListener('pointercancel', cancel);
      canvas.addEventListener('lostpointercapture', cancel);
      window.addEventListener('blur', () => cancel());
      canvas.addEventListener('wheel', event => {
        if (typeof handlers.wheel !== 'function') return;
        event.preventDefault();
        const pixels = event.deltaMode === 1 ? event.deltaY * 16 :
          event.deltaMode === 2 ? event.deltaY * platform.height : event.deltaY;
        handlers.wheel(pixels);
      }, { passive: false });
    },
    onLifecycle(hide, show) {
      const hideAndCancel = () => {
        platform.isVisible = false;
        if (platform.cancelInput) platform.cancelInput();
        hide();
      };
      const showIfVisible = () => {
        if (document.hidden) return;
        platform.isVisible = true;
        show();
      };
      document.addEventListener('visibilitychange', () => document.hidden ? hideAndCancel() : showIfVisible());
      window.addEventListener('pagehide', hideAndCancel);
      window.addEventListener('pageshow', showIfVisible);
    },
    onResize(callback) {
      const resize = () => { platform.width = canvas.clientWidth; platform.height = canvas.clientHeight; callback(); };
      window.addEventListener('resize', resize); resize();
    },
    reportError(error) { console.error('[爆米花工坊]', error); },
  };
  return platform;
}

module.exports = { createPlatform };
