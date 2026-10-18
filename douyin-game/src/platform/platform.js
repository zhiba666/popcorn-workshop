'use strict';

const { PRODUCTION_CONFIG, PRODUCT_DEFINITIONS } = require('../domain/production/production-config');
const { lineProductionFeedback } = require('../presentation/factory/production-feedback');

const SAVE_KEY = 'popcorn-dual-product-v4';
const LEGACY_SAVE_KEY = 'popcorn-original-single-line-v1';
const PREFERENCES_KEY = 'popcorn-ui-settings-v1';
const RECOVERY_BACKUP_KEY = SAVE_KEY + '-recovery-backup-v1';

function saveError(code, cause) {
  const error = new Error(code === 'invalid-save' ? '已有存档内容无效' :
    code === 'backup-failed' ? '旧存档备份失败，尚未重新开始' : '新存档保存失败，旧存档备份已保留');
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function backupAndWriteSave({ readEntries, readBackup, writeBackup, writeSave }, value) {
  let backupKey;
  try {
    // Read raw values before parsing: even malformed browser JSON must survive.
    // Keep both keys, while retaining the current save's normal read priority.
    const entries = readEntries();
    const fingerprint = JSON.stringify(entries);
    for (let suffix = 1; ; suffix++) {
      backupKey = RECOVERY_BACKUP_KEY + (suffix === 1 ? '' : '-' + suffix);
      const existing = readBackup(backupKey);
      if (!existing.exists) {
        writeBackup(backupKey, { backupVersion: 1, createdAt: Date.now(),
          sourceKey: entries.length ? entries[0].key : null, entries });
        break;
      }
      // Reuse a completed backup after an active-save write failed. Never
      // overwrite an older recovery backup, including one we cannot parse.
      if (existing.value && existing.value.backupVersion === 1 &&
          JSON.stringify(existing.value.entries) === fingerprint) break;
    }
  } catch (error) { throw saveError('backup-failed', error); }
  try { writeSave(value); }
  catch (error) { throw saveError('write-failed', error); }
  return { backupKey };
}

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
      if (value == null) throw saveError('invalid-save');
      return value;
    },
    writeSave(value) { api.setStorageSync(SAVE_KEY, value); },
    backupAndWriteSave(value) {
      return backupAndWriteSave({
        readEntries() {
          const keys = api.getStorageInfoSync().keys;
          return [SAVE_KEY, LEGACY_SAVE_KEY].filter(key => keys.includes(key)).map(key =>
            ({ key, value: api.getStorageSync(key) }));
        },
        readBackup(key) {
          const exists = api.getStorageInfoSync().keys.includes(key);
          return { exists, value: exists ? api.getStorageSync(key) : null };
        },
        writeBackup: (key, backup) => api.setStorageSync(key, backup),
        writeSave: next => platform.writeSave(next),
      }, value);
    },
    readPreferences() { return api.getStorageSync(PREFERENCES_KEY) || null; },
    writePreferences(value) { api.setStorageSync(PREFERENCES_KEY, { reducedMotion: value.reducedMotion === true }); },
    onInput(handlers) {
      const active = new Map();
      const touchId = touch => touch.identifier == null ? touch.id : touch.identifier;
      const points = (event, ending = false) => {
        if (event.touches != null) {
          active.clear();
          Array.from(event.touches).forEach(touch => active.set(touchId(touch), touch));
        } else Array.from(event.changedTouches || []).forEach(touch => {
          if (ending) active.delete(touchId(touch));
          else active.set(touchId(touch), touch);
        });
        return Array.from(active.values());
      };
      // start/move receive the complete active set. end keeps the original
      // ended-touch first argument and provides the remaining set separately.
      api.onTouchStart(event => handlers.start(points(event), event.changedTouches || []));
      api.onTouchMove(event => handlers.move(points(event), event.changedTouches || []));
      api.onTouchEnd(event => handlers.end(event.changedTouches || [], points(event, true)));
      platform.cancelInput = () => { active.clear(); handlers.cancel(); };
      api.onTouchCancel(platform.cancelInput);
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
      const recovery = ui && ui.recovery;
      const screen = recovery ? 'recovery' : ui && ui.entry ? 'entry' : state.page;
      canvas.setAttribute('data-screen', screen);
      canvas.setAttribute('data-reduced-motion', String(!!(ui && ui.reducedMotion)));
      canvas.setAttribute('data-factory-view', ui?.factoryViewMode || 'detail');
      canvas.setAttribute('data-factory-zoom', String(ui?.factoryCamera?.zoom || 1));
      canvas.setAttribute('data-factory-camera', JSON.stringify(ui?.factoryCamera || null));
      canvas.setAttribute('data-factory-dock', ui?.factoryDockExpanded ? 'expanded' : 'collapsed');
      canvas.setAttribute('data-factory-order', ui?.factoryOrderExpanded ? 'expanded' : 'collapsed');
      canvas.setAttribute('data-factory-service', ui?.factoryServiceFocus || '');
      canvas.setAttribute('data-upgrade-tab', ui?.upgradeDialog ? ui.upgradeTab || 'capacity' : '');
      canvas.setAttribute('data-upgrade-details', String(!!(ui?.upgradeDialog && ui.upgradeDetailsOpen)));
      const factoryJourney = ui?.factoryPresentation?.construction;
      const packagingRecovery = ui?.factoryPresentation?.packaging;
      canvas.setAttribute('data-factory-journey-phase', factoryJourney?.phase || '');
      canvas.setAttribute('data-factory-journey-line', factoryJourney?.lineId || '');
      canvas.setAttribute('data-packaging-recovery', !packagingRecovery ? '' : packagingRecovery.cleared ? 'cleared' :
        packagingRecovery.pending ? 'pending' : packagingRecovery.speedOnly ? 'upgraded' : 'draining');
      const selectedLine = state.lines.find(line => line.id === state.selectedLineId);
      const productionFeedback = factoryJourney && factoryJourney.lineId === selectedLine?.id ?
        { ...factoryJourney, firstBatch: !factoryJourney.completed, batchId: factoryJourney.batchId } :
        selectedLine ? lineProductionFeedback(state, selectedLine) : null;
      canvas.setAttribute('data-production-feedback', productionFeedback?.text || '');
      canvas.setAttribute('data-first-piece-phase', productionFeedback ?
        (productionFeedback.firstBatch ? productionFeedback.phase : 'stocked') : '');
      canvas.setAttribute('data-first-piece-line', productionFeedback?.firstBatch ? productionFeedback.lineId : '');
      canvas.setAttribute('data-first-piece-batch-id', !productionFeedback?.firstBatch || productionFeedback.batchId == null ? '' : String(productionFeedback.batchId));
      if (recovery) {
        const label = '爆米花工坊，存档恢复，' + recovery.title + '，' + recovery.lines.join('，') +
          (recovery.message ? '，' + recovery.message : '') + (recovery.confirm ?
            '，确认备份后重新开始，返回。' : '，重试读取，备份后重新开始。');
        if (label !== publishedLabel) { canvas.setAttribute('aria-label', label); publishedLabel = label; }
        return;
      }
      if (ui && ui.entry) {
        const label = '爆米花工坊，游戏入口，进入游戏。' + (ui.settingsOpen ?
          '设置已打开，减少动效' + (ui.reducedMotion ? '已开启' : '已关闭') + '，关闭设置。' : '打开设置。');
        if (label !== publishedLabel) { canvas.setAttribute('aria-label', label); publishedLabel = label; }
        return;
      }
      const customers = ui?.customers || [];
      if (state.page === 'customers') {
        const info = customers.find(item => item.customer.id === ui.selectedCustomerId);
        canvas.setAttribute('data-customer', info?.customer.id || '');
        const status = item => !item.eligible ? '尚未开放' : !item.collected ? '新面孔，未收录' :
          item.progress.stars + '星，' + item.progress.label + '，已完成超级订单' + item.superOrdersCompleted + '张，累计服务' + item.services + '次';
        const next = item => item.progress.stars === 5 ? '五星老朋友' :
          '再完成' + item.progress.remaining + '张超级订单达到' + item.progress.nextStar + '星，超级订单尚未开放';
        const description = info ? info.customer.name + '的档案，' + status(info) +
          (info.eligible ? '，' + info.customer.identity + '，' + next(info) + (info.nextSuperOrder ?
            '，超级订单第' + info.nextSuperOrder.sequence + '张，' + (info.nextSuperOrder.available ? '可追踪' : '需先投产所需产品') : '') +
            (info.visiting ? '，正在来访，可查看普通订单' : '，下次来访可继续服务') :
            '，对应新品首次产出并正式入库后可来访') + '，返回图鉴，向下滑动查看关系记录' +
          (ui.customerBubbleOpen ? '，对白已打开' : '') :
          '顾客图鉴，已结识' + customers.filter(item => item.collected).length + '/' + customers.length + '，' +
          customers.map(item => item.customer.name + '，' + status(item) + (item.visiting ? '，正在来访' : '') + (item.unread ? '，有新记录' : '')).join('；');
        const label = '爆米花工坊，顾客页，金币' + state.coins + '，' + description + '。工厂、棋盘、顾客导航。';
        if (label !== publishedLabel) { canvas.setAttribute('aria-label', label); publishedLabel = label; }
        return;
      }
      canvas.removeAttribute('data-customer');
      const productName = id => PRODUCT_DEFINITIONS[id]?.name || '产品';
      const workshopName = id => PRODUCT_DEFINITIONS[id]?.workshopName || '新工坊';
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
      const orders = [...(state.orders || [state.order]), ...(state.superOrder ? [state.superOrder] : [])];
      const orderStatuses = { ready: '棋盘齐货可手动交付', 'materials-ready': '材料够，待发射或合成',
        'missing-materials': '继续生产备料' };
      const orderDescription = orders.map((order, index) => {
        const progress = ui && ui.orders && ui.orders.find(item => item.orderId === order.id);
        const requirements = order.requirements.map(item => {
          const found = state.board.some(piece => piece && piece.kind === 'product' &&
            piece.product === item.product && piece.level >= item.level);
          return productName(item.product) + '最低' + item.level + '级一份，棋盘' + (found ? '1/1' : '0/1');
        }).join('、');
        const customer = customers.find(item => item.customer.id === order.customerId);
        return '第' + (index + 1) + '张' + (order.kind === 'super' ? '超级订单（进度' + order.sequence + '/16）' : '普通订单') + (order.id === state.focusedOrderId ? '（当前关注）' : '') +
          (customer ? '，顾客' + customer.customer.name + '，' + customer.progress.stars + '星' : '') +
          '需要' + requirements + '，奖励' + order.reward + (progress ? '，' + orderStatuses[progress.status] : '');
      }).join('；');
      const services = ui && ui.customerServiceCount;
      const customerDescription = services == null ? '' : '，兔快递员累计服务' + services + '次';
      const offline = ui && ui.offlineSummary;
      const pagination = ui && ui.offlinePagination;
      const returnedEntries = offline ? (pagination ? offline.producedByLine.slice(
        pagination.page * pagination.pageSize, (pagination.page + 1) * pagination.pageSize) : offline.producedByLine) : [];
      const returnedStock = offline ? '，离线入库' + (pagination && pagination.pageCount > 1 ?
        '第' + (pagination.page + 1) + '/' + pagination.pageCount + '页，共' + offline.producedByLine.length + '条线，' : '') + returnedEntries.map(item =>
        lineName(item.lineId, item.product) + 'Lv.' + item.level + '新增' + item.units + '份').join('、') +
        (pagination && pagination.page > 0 ? '，可查看上一页' : '') +
        (pagination && pagination.page + 1 < pagination.pageCount ? '，可查看下一页' : '') +
        (offline.capped ? '，每次离开最多结算两小时' : '') + (offline.saveFailed ? '，尚未保存' : '，已保存') : '';
      const upgradeOffers = ui && ui.upgradeOffers;
      const describeUpgrade = (name, offer) => name + (offer.maxed ? '已满级' :
        '费用' + offer.cost + '金币，' + (offer.affordable ? '可以升级' : '金币不足'));
      const upgrade = ui && ui.upgradeDialog ? '，' + lineName(state.selectedLineId) + '升级面板已打开，当前页签' +
        (ui.upgradeTab === 'output' ? '出厂升阶' : '加工提速') + (ui.upgradeDetailsOpen ? '，升级规则已展开，购买暂不可用' : '') + (upgradeOffers ?
        '，' + describeUpgrade('加工提速', upgradeOffers.capacity) + '，' + describeUpgrade('出厂升阶', upgradeOffers.output) : '') : '';
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
      const construction = ui && ui.productConstruction;
      const constructionOffer = construction && construction.offer;
      const constructionDescription = constructionOffer ? '，建设' + workshopName(construction.product) + '面板已打开，费用' +
        constructionOffer.cost + '金币，' + (constructionOffer.canBuy ? '可以建设' :
          constructionOffer.reason === 'board-full' ? '棋盘需腾出一格' :
          constructionOffer.reason === 'insufficient-coins' ? '金币不足，还差' + Math.max(0, constructionOffer.cost - state.coins) + '金币' : '暂不能建设') +
        '，含一级产线、独立库存、占一格的发射器及公共配套' : '';
      const productProgress = PRODUCTION_CONFIG.products.slice(1).map(product => {
        const built = state.lines.some(line => line.product === product);
        return '，' + workshopName(product) + (!built ? '尚未建设' :
          (state.firstStockedProducts || []).includes(product) ? '已完成首次入库' : '已建成，首批自动生产中');
      }).join('');
      const firstStocked = offline?.firstStockedProducts?.length ? '，' + offline.firstStockedProducts.map(productName).join('、') + '首次入库' : '';
      const label = '爆米花工坊，' + (state.page === 'board' ? '棋盘' : '工厂') + '页，金币' + state.coins +
        (state.page === 'factory' ? '，' + (ui?.factoryViewMode === 'overview' ? '工厂总览' : '设备近景') +
          '，可切换产品、上一条或下一条产线，点击瓶颈提示定位设备' +
          (ui?.factoryViewMode === 'overview' ? '' : '，可单指拖动、双指缩放，归位返回当前产线') +
          '，设备面板已' + (ui?.factoryDockExpanded ? '展开' : '收起，点击产线摘要展开操作') +
          '，订单' + (ui?.factoryOrderExpanded ? '已展开' : '摘要可展开') +
          (ui?.factoryServiceFocus ? '，已定位' + ({ supply: '公共供料', packaging: '公共包装', warehouse: '仓储' }[ui.factoryServiceFocus] || '') : '') : '') +
        '，已交付' + state.completedOrders + '单，并行订单' + orders.length + '张，左右滑动切换关注。' +
        orderDescription + customerDescription +
        '，当前选线' + lineName(state.selectedLineId) + '（' + state.selectedLineId + '）。' +
        (productionFeedback ? '当前生产状态：' + productionFeedback.text + '。' : '') + lines + sharedState + packagingState +
        upgrade + sharedDescription + bottleneckDescription + expansionDescription + constructionDescription + productProgress + returnedStock + firstStocked +
        (ui?.boardFlowDescription ? '。' + ui.boardFlowDescription : '') + '。' + occupied;
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
      let saved;
      try { saved = JSON.parse(value); }
      catch (error) { throw saveError('invalid-save', error); }
      if (saved === null) throw saveError('invalid-save');
      return saved;
    },
    writeSave(value) { window.localStorage.setItem(SAVE_KEY, JSON.stringify(value)); },
    backupAndWriteSave(value) {
      return backupAndWriteSave({
        readEntries() {
          return [SAVE_KEY, LEGACY_SAVE_KEY].map(key => ({ key, value: window.localStorage.getItem(key) }))
            .filter(entry => entry.value !== null);
        },
        readBackup(key) {
          const raw = window.localStorage.getItem(key);
          if (raw === null) return { exists: false, value: null };
          let value = null;
          try { value = JSON.parse(raw); } catch (error) { /* Preserve unreadable backups too. */ }
          return { exists: true, value };
        },
        writeBackup: (key, backup) => window.localStorage.setItem(key, JSON.stringify(backup)),
        writeSave: next => platform.writeSave(next),
      }, value);
    },
    readPreferences() {
      const value = window.localStorage.getItem(PREFERENCES_KEY);
      return value === null ? null : JSON.parse(value);
    },
    writePreferences(value) { window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ reducedMotion: value.reducedMotion === true })); },
    onInput(handlers) {
      const activePointers = new Map();
      const point = event => {
        const rect = canvas.getBoundingClientRect();
        return { identifier: event.pointerId, clientX: (event.clientX - rect.left) * platform.width / rect.width,
          clientY: (event.clientY - rect.top) * platform.height / rect.height };
      };
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || activePointers.has(event.pointerId)) return;
        const changed = point(event);
        activePointers.set(event.pointerId, changed);
        event.preventDefault(); canvas.setPointerCapture(event.pointerId);
        handlers.start(Array.from(activePointers.values()), [changed]);
      });
      canvas.addEventListener('pointermove', event => {
        if (!activePointers.has(event.pointerId)) return;
        const changed = point(event);
        activePointers.set(event.pointerId, changed);
        event.preventDefault(); handlers.move(Array.from(activePointers.values()), [changed]);
      });
      canvas.addEventListener('pointerup', event => {
        if (!activePointers.has(event.pointerId)) return;
        const ended = point(event);
        // Remove before releasing capture: its lostpointercapture event must
        // never cancel another finger which is still holding the canvas.
        activePointers.delete(event.pointerId);
        event.preventDefault(); handlers.end([ended], Array.from(activePointers.values()));
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      });
      const cancel = event => {
        if (event && !activePointers.has(event.pointerId)) return;
        const pointers = Array.from(activePointers.keys());
        activePointers.clear();
        pointers.forEach(pointer => {
          if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
        });
        handlers.cancel();
      };
      platform.cancelInput = () => cancel();
      canvas.addEventListener('pointercancel', cancel);
      canvas.addEventListener('lostpointercapture', cancel);
      window.addEventListener('blur', () => cancel());
      canvas.addEventListener('wheel', event => {
        if (typeof handlers.wheel !== 'function') return;
        const pixels = event.deltaMode === 1 ? event.deltaY * 16 :
          event.deltaMode === 2 ? event.deltaY * platform.height : event.deltaY;
        if (handlers.wheel(pixels, [point(event)], { ctrlKey: event.ctrlKey, metaKey: event.metaKey }) !== false)
          event.preventDefault();
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
