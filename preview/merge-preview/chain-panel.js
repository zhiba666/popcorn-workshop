// A self-contained reference panel for the disposable merge workbench.
// Locating a source only identifies its existing board item; it never launches it.
export function createChainPanel({ getState, getDiscovered, art, productName, getSources,
  getProductChain, getPreparationPlan, onLocate = () => {}, onLocateItem = () => {}, onOpen = () => {}, onClose = () => {} }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'chain-panel';
  dialog.setAttribute('aria-labelledby', 'chain-panel-title');
  dialog.setAttribute('aria-describedby', 'chain-panel-intro');
  dialog.innerHTML = `<div class="chain-panel-shell">
    <header class="chain-panel-header">
      <div><p class="chain-panel-eyebrow">合成图鉴</p><h2 id="chain-panel-title"></h2></div>
      <button type="button" class="chain-panel-close" aria-label="关闭合成图鉴">×</button>
    </header>
    <div class="chain-panel-content">
      <p id="chain-panel-intro" class="chain-panel-intro">同种同级两份合成一级，左右滑动查看等级。</p>
      <div class="chain-panel-track" aria-label="商品合成链，可左右滑动">
        <div class="chain-panel-levels" role="group" aria-label="选择目标等级"></div>
      </div>
      <section class="chain-panel-target" aria-labelledby="chain-target-name">
        <div class="chain-target-art"><img alt="" draggable="false"><span aria-hidden="true">?</span></div>
        <div><h3 id="chain-target-name"></h3><p class="chain-target-discovery"></p><p class="chain-target-count"></p><p class="chain-order-context" hidden></p></div>
      </section>
      <section class="chain-preparation" aria-label="本单备货建议" hidden>
        <p class="chain-preparation-summary"></p><p class="chain-preparation-stock" hidden></p><p class="chain-preparation-note" hidden></p>
        <button type="button" class="chain-preparation-locate" hidden>定位可合成商品</button>
      </section>
      <section class="chain-panel-sources" aria-labelledby="chain-sources-title">
        <div class="chain-sources-heading"><h3 id="chain-sources-title">从哪里获得</h3><span class="chain-sources-count"></span></div>
        <p class="chain-panel-source-intro">定位后，在棋盘点击或长按取货。</p>
        <div class="chain-sources-list"></div>
        <p class="chain-sources-empty" hidden>棋盘上暂时没有这个口味的发射器。</p>
      </section>
    </div>
  </div>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const levels = $('.chain-panel-levels'), track = $('.chain-panel-track');
  const sourcesList = $('.chain-sources-list');
  const sourceViews = new Map();
  let target = null, renderedProduct = null, chainViews = [], closeContext = { reason: 'close' };

  function known(product, level) {
    return Boolean(getDiscovered()?.has(`${product}/${level}`));
  }
  function paintArt(container, product, level, discovered) {
    const img = container.querySelector('img');
    const question = container.querySelector('span');
    img.hidden = !discovered;
    question.hidden = discovered;
    if (discovered) {
      const src = art({ kind: 'product', product, level });
      if (img.getAttribute('src') !== src) img.src = src;
    } else {
      // Never request an undiscovered product image, even while it is hidden.
      img.removeAttribute('src');
    }
  }
  function scrollToTarget() {
    const selected = chainViews.find(view => view.entry.level === target?.level)?.button;
    if (!selected) return;
    // Scroll only this horizontal track: opening the panel must not move the page.
    const left = selected.offsetLeft - (track.clientWidth - selected.offsetWidth) / 2;
    track.scrollLeft = Math.max(0, left);
  }
  function chooseLevel(level, focus = false) {
    if (!target) return;
    target = { ...target, level, orderId: level === target.level ? target.orderId : null };
    refresh();
    const button = chainViews.find(view => view.entry.level === level)?.button;
    if (focus) button?.focus({ preventScroll: true });
    scrollToTarget();
  }
  function makeChain() {
    renderedProduct = target.product;
    chainViews = getProductChain(target.product).map(entry => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'chain-level';
      button.dataset.level = entry.level;
      button.innerHTML = '<span class="chain-level-art"><img alt="" draggable="false"><span aria-hidden="true">?</span></span>' +
        '<strong></strong><small></small>';
      button.addEventListener('click', () => chooseLevel(entry.level));
      button.addEventListener('keydown', event => {
        const index = chainViews.findIndex(view => view.entry.level === entry.level);
        const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 :
          event.key === 'Home' ? 0 : event.key === 'End' ? chainViews.length - 1 : -1;
        if (next < 0 || next >= chainViews.length) return;
        event.preventDefault(); chooseLevel(chainViews[next].entry.level, true);
      });
      return { entry, button };
    });
    levels.replaceChildren(...chainViews.map(view => view.button));
  }
  function makeSource(source) {
    const element = document.createElement('article');
    element.className = 'chain-source';
    element.innerHTML = '<div class="chain-source-top"><img class="chain-source-art" alt="" draggable="false">' +
      '<div class="chain-source-copy"><h4></h4><p class="chain-source-stock"></p></div>' +
      '<span class="chain-source-status"></span></div><p class="chain-source-cost"></p>' +
      '<p class="chain-source-safety" hidden></p><p class="chain-source-wait"></p><button type="button" class="chain-source-locate">定位发射器 <span aria-hidden="true">↗</span></button>';
    const button = element.querySelector('button');
    button.addEventListener('click', () => {
      const current = getSources(getState(), target.product, target.level)
        .find(entry => entry.itemId === source.itemId);
      if (!current) { refresh(); return; }
      closeContext = { reason: 'locate', itemId: current.itemId };
      dialog.close('locate');
      onLocate({ itemId: current.itemId, preparation: preparationContext() });
    });
    return { element, button, image: element.querySelector('img'), title: element.querySelector('h4'),
      stock: element.querySelector('.chain-source-stock'), status: element.querySelector('.chain-source-status'),
      cost: element.querySelector('.chain-source-cost'), safety: element.querySelector('.chain-source-safety'), wait: element.querySelector('.chain-source-wait') };
  }
  function preparationContext() {
    return target?.orderId ? { product: target.product, level: target.level, orderId: target.orderId } : null;
  }
  function preparationState(state) {
    const order = state.orders.find(entry => entry.id === target?.orderId);
    const quantity = order?.requirements.filter(entry => entry.product === target.product && entry.level === target.level).length;
    return quantity ? { order, plan: getPreparationPlan(state, target.product, target.level, quantity, order.id) } : null;
  }
  function preparedItems(plan) {
    return [...plan.qualifiedItems].sort((left, right) => left.level - right.level || left.index - right.index);
  }
  function levelSummary(items) {
    const counts = new Map();
    for (const item of items) counts.set(item.level, (counts.get(item.level) || 0) + 1);
    return [...counts].map(([level, quantity]) => `Lv.${level} ×${quantity}`).join('、');
  }
  $('.chain-preparation-locate').addEventListener('click', () => {
    const state = getState(), current = preparationState(state);
    if (!current) { refresh(); return; }
    const { plan } = current;
    const index = plan.complete ? preparedItems(plan)[0]?.index : plan.nextMerge?.from;
    const item = state.board[index];
    if (!item) { refresh(); return; }
    closeContext = { reason: 'locate-item', itemId: item.id };
    dialog.close('locate-item');
    onLocateItem({ itemId: item.id, preparation: preparationContext() });
  });
  function refresh() {
    if (!target || !dialog.open) return;
    if (renderedProduct !== target.product) makeChain();
    const state = getState();
    const preparation = preparationState(state), plan = preparation?.plan;
    const discovered = known(target.product, target.level);
    const name = productName(target.product);
    $('#chain-panel-title').textContent = `${name}合成链`;
    for (const { entry, button } of chainViews) {
      const found = known(target.product, entry.level), selected = entry.level === target.level;
      paintArt(button.querySelector('.chain-level-art'), target.product, entry.level, found);
      button.classList.toggle('undiscovered', !found);
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${name} Lv.${entry.level}，${found ? '已发现' : '尚未发现'}${selected ? '，当前查看' : ''}`);
      button.querySelector('strong').textContent = `Lv.${entry.level}`;
      button.querySelector('small').textContent = found ? '已发现' : '未发现';
    }
    paintArt($('.chain-target-art'), target.product, target.level, discovered);
    $('#chain-target-name').textContent = `${name} · Lv.${target.level}`;
    $('.chain-target-discovery').textContent = discovered ? '已发现' : '尚未发现 · 首次获得后点亮';
    const quantity = state.board.filter(item => item?.kind === 'product' && item.product === target.product && item.level === target.level).length;
    $('.chain-target-count').textContent = plan
      ? `本单需要${plan.quantity}份 · 已备${Math.min(plan.owned, plan.quantity)}份 · 还缺${plan.missing}份`
      : `同级现货 ${quantity} 份`;
    $('.chain-order-context').hidden = !preparation;
    $('.chain-order-context').textContent = preparation?.order.label || '';
    $('.chain-preparation').hidden = !preparation;
    if (preparation) {
      const items = preparedItems(plan), higherItems = items.filter(item => item.level > target.level);
      $('.chain-preparation-summary').textContent = plan.complete ? '本单成品已备好，无需继续取货或合成。'
        : plan.canCompleteFromBoard ? `材料已够，再合成${plan.boardMergesNeeded}次即可。`
          : plan.nextMerge ? '先合成现有商品，再按下方数量补货。'
            : '按下方数量取货，再合成目标成品。';
      const stock = higherItems.length ? `${levelSummary(higherItems)} 可代交本单 Lv.${target.level} 需求。` : '';
      $('.chain-preparation-stock').textContent = stock; $('.chain-preparation-stock').hidden = !stock;
      const note = !plan.complete && plan.futureReserveCount
        ? `合成时保留${plan.safetyReserveByLevel.map(entry => `Lv.${entry.level} ×${entry.count}`).join('、')}，供其他订单使用。`
        : !plan.complete && plan.hasReservedMaterials ? `已为其他订单留出${plan.reservedCount}件现货。` : '';
      $('.chain-preparation-note').textContent = note; $('.chain-preparation-note').hidden = !note;
      $('.chain-preparation-locate').hidden = !plan.complete && !plan.nextMerge;
      $('.chain-preparation-locate').textContent = plan.complete ? `查看已备成品 · Lv.${items[0].level}` : '定位可合成商品';
    }

    const sources = plan ? plan.sources : getSources(state, target.product, target.level);
    $('.chain-panel-sources').hidden = !!plan && (plan.complete || plan.canCompleteFromBoard);
    const activeIds = new Set(sources.map(source => source.itemId));
    for (const [id, view] of sourceViews) if (!activeIds.has(id)) {
      view.element.remove(); sourceViews.delete(id);
    }
    $('.chain-sources-count').textContent = `${sources.length} 个来源`;
    $('.chain-sources-empty').hidden = sources.length > 0;
    for (const source of sources) {
      let view = sourceViews.get(source.itemId);
      if (!view) { view = makeSource(source); sourceViews.set(source.itemId, view); sourcesList.append(view.element); }
      const status = source.status || {};
      const kind = status.kind || (source.stock > 0 ? 'ready' : 'producing');
      const src = art({ kind: 'launcher', product: source.product, level: source.level });
      if (view.image.getAttribute('src') !== src) view.image.src = src;
      view.title.textContent = `${name} · ${source.lineNumber}号线`;
      view.stock.textContent = `出厂 Lv.${source.level} · 库存 ${source.stock} 份`;
      view.status.dataset.state = kind;
      view.status.textContent = { ready: '可取货', producing: '生产中', 'board-full': '满盘停发' }[kind] || '生产中';
      view.element.classList.toggle('unsuitable', !source.canSupply);
      if (plan?.complete) view.cost.textContent = '本单目标已备好，无需继续取货。';
      else if (!source.canSupply) view.cost.textContent = '此来源暂不能用于当前目标。';
      else if (source.level > target.level) view.cost.textContent = plan
        ? `再取${source.drawsNeeded}份 Lv.${source.level} 成品可代交，无需合成。`
        : `直接取 Lv.${source.level} 成品，可用于 Lv.${target.level} 及以下订单。`;
      else if (plan) view.cost.textContent = source.drawsNeeded === 0
        ? `现有材料已够 · 额外取货0份 · 合成${source.mergesNeeded}次`
        : `${source.boardItemsUsed ? `利用${source.boardItemsUsed}件棋盘材料：` : ''}再取${source.drawsNeeded}份 · 合成${source.mergesNeeded}次`;
      else if (source.level === target.level) view.cost.textContent = '直接获得目标等级，无需合成。';
      else {
        const units = 2 ** Math.max(0, target.level - source.level);
        view.cost.textContent = `从此来源制作 1 份：取货 ${units} 份 · 合成 ${source.mergesNeeded ?? units - 1} 次`;
      }
      const units = plan ? source.drawsNeeded : source.canSupply ? 2 ** Math.max(0, target.level - source.level) : 0;
      let wait = '';
      if (plan && (!units || !source.canSupply)) wait = '';
      else if (kind === 'board-full') wait = '棋盘已满，先合成或交付腾出空格。';
      else if (kind === 'producing') wait = Number.isFinite(status.remainingSeconds)
        ? `约 ${Math.ceil(status.remainingSeconds)} 秒后补一份，补货后可取货。` : '正在补货，库存恢复后可取货。';
      else if (source.canSupply && source.stock < units) wait = `现有库存少于 ${units} 份，制作途中需要等待补货。`;
      view.wait.textContent = wait; view.wait.hidden = !wait;
      const sameReserve = plan && JSON.stringify(source.safetyReserveByLevel) === JSON.stringify(plan.safetyReserveByLevel);
      const safety = plan && source.futureReserveCount && !sameReserve
        ? `此路线需留${source.safetyReserveByLevel.map(entry => `Lv.${entry.level} ×${entry.count}`).join('、')}供其他订单使用。` : '';
      view.safety.textContent = safety; view.safety.hidden = !safety;
      view.button.disabled = !!plan && (plan.complete || source.drawsNeeded === 0 || !source.canSupply);
      view.button.textContent = view.button.disabled ? !source.canSupply && !plan.complete ? '此线无法提供目标等级' : '无需取货' : '定位发射器 ↗';
      view.button.setAttribute('aria-label', view.button.disabled ? `${name}${source.lineNumber}号线，${view.button.textContent}`
        : `定位${name}${source.lineNumber}号线${source.canSupply ? '' : '，此线不能提供目标等级'}`);
    }
  }
  function close() {
    if (!dialog.open) return;
    closeContext = { reason: 'close' };
    dialog.close();
  }
  $('.chain-panel-close').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => onClose(closeContext));
  return {
    open({ product, level, orderId = null }) {
      const chain = getProductChain(product);
      if (!chain.length) return;
      target = { product, level: chain.some(entry => entry.level === level) ? level : chain[0].level, orderId };
      closeContext = { reason: 'close' };
      if (!dialog.open) { onOpen(target); dialog.showModal(); }
      $('.chain-panel-content').scrollTop = 0;
      refresh();
      scrollToTarget();
      $('.chain-panel-close').focus({ preventScroll: true });
    },
    refresh, close,
    isOpen: () => dialog.open,
  };
}
