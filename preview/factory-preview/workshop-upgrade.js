const DEFAULT_BALANCE = 600;
const MAX_LEVEL = 6;

const sharedServices = {
  supply: ['公共供料', '沿中央供料主干，为所有已建产线提供原料。'],
  packer: ['公共包装', '接收各条产线独立缓存中的成品，包装后送往仓库。'],
  warehouse: ['公共仓库', '统一接收公共包装后的成品。'],
};

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function normalize(selection) {
  if (!selection) return null;
  return {
    ...selection,
    level: Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(selection.level) || 1))),
  };
}

/** A preview-only, in-memory upgrade sheet. The caller owns device levels. */
export class WorkshopUpgrade {
  constructor({ host, getSelection, onUpgrade, onClose, balance = DEFAULT_BALANCE }) {
    if (!host) throw new Error('WorkshopUpgrade requires a host element.');
    this.host = host;
    this.getSelection = getSelection;
    this.onUpgrade = onUpgrade;
    this.onClose = onClose;
    this.initialBalance = Math.max(0, Math.floor(Number(balance) || 0));
    this.balance = this.initialBalance;
    this.selection = null;
    this.isOpen = false;
    this.busy = false;
    this.message = '';
    this.opener = null;

    const sheet = this.sheet = make('section', 'workshop-upgrade');
    sheet.id = 'upgrade-sheet';
    sheet.hidden = true;
    sheet.tabIndex = -1;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'false');
    sheet.setAttribute('aria-labelledby', 'upgrade-title');
    sheet.setAttribute('aria-describedby', 'upgrade-scope');

    const header = make('header', 'upgrade-header');
    const heading = make('div', 'upgrade-heading');
    heading.append(make('span', 'upgrade-eyebrow', '布局演示'));
    const title = make('h2', '', '设备升级');
    title.id = 'upgrade-title';
    heading.append(title);
    const close = this.closeButton = make('button', 'upgrade-close', '×');
    close.type = 'button';
    close.id = 'upgrade-close';
    close.setAttribute('aria-label', '关闭升级，返回场景');
    close.addEventListener('click', () => this.close());
    header.append(heading, close);

    const body = make('div', 'upgrade-body');
    const name = this.nameElement = make('strong', 'upgrade-device-name');
    name.id = 'upgrade-name';
    const target = this.targetElement = make('p', 'upgrade-target');
    target.id = 'upgrade-target';
    body.append(name, target);

    const comparison = this.comparison = make('div', 'upgrade-comparison');
    const current = make('div', 'upgrade-level-card');
    current.append(make('span', '', '当前等级'));
    this.currentLevel = make('strong');
    this.currentLevel.id = 'upgrade-current-level';
    current.append(this.currentLevel);
    const arrow = make('span', 'upgrade-level-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    const next = make('div', 'upgrade-level-card upgrade-next');
    this.nextCaption = make('span', '', '升级后');
    this.nextLevel = make('strong');
    this.nextLevel.id = 'upgrade-next-level';
    next.append(this.nextCaption, this.nextLevel);
    comparison.append(current, arrow, next);
    body.append(comparison);

    this.effect = make('p', 'upgrade-effect');
    this.effect.id = 'upgrade-effect';
    body.append(this.effect);
    this.scope = make('p', 'upgrade-scope', '示例币与等级仅在本页生效；不代表正式费用、产能或游戏进度。');
    this.scope.id = 'upgrade-scope';
    body.append(this.scope);

    const footer = make('footer', 'upgrade-footer');
    this.wallet = make('div', 'upgrade-wallet');
    this.wallet.append(make('span', '', '可用示例币'));
    this.balanceElement = make('strong');
    this.balanceElement.id = 'upgrade-balance';
    this.wallet.append(this.balanceElement);
    this.status = make('p', 'upgrade-status');
    this.status.id = 'upgrade-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.submit = make('button', 'upgrade-submit');
    this.submit.type = 'button';
    this.submit.id = 'upgrade-submit';
    this.submit.addEventListener('click', () => this.upgrade());
    this.refill = make('button', 'upgrade-refill', `补充 ${DEFAULT_BALANCE} 示例币`);
    this.refill.type = 'button';
    this.refill.id = 'upgrade-refill';
    this.refill.addEventListener('click', () => {
      this.balance += DEFAULT_BALANCE;
      this.message = `已补充 ${DEFAULT_BALANCE} 示例币，可继续预览升级。`;
      this.render();
    });
    footer.append(this.wallet, this.status, this.submit, this.refill);
    sheet.append(header, body, footer);
    host.append(sheet);
    this.onKeyDown = event => {
      if (this.isOpen && event.key === 'Escape' && host.contains(event.target)) {
        event.preventDefault();
        this.close();
      }
    };
    host.addEventListener('keydown', this.onKeyDown);
    this.update(getSelection?.());
  }

  open(selection = this.getSelection?.()) {
    if (!this.isOpen) this.opener = document.activeElement;
    this.isOpen = true;
    this.sheet.hidden = false;
    this.host.classList.add('upgrade-open');
    this.update(selection);
    this.closeButton.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.sheet.hidden = true;
    this.host.classList.remove('upgrade-open');
    if (this.opener?.isConnected && !this.opener.disabled) this.opener.focus({ preventScroll: true });
    this.onClose?.();
  }

  update(selection = this.getSelection?.()) {
    const next = normalize(selection);
    if (next?.id !== this.selection?.id) this.message = '';
    this.selection = next;
    this.render();
  }

  reset({ balance = this.initialBalance } = {}) {
    this.balance = Math.max(0, Math.floor(Number(balance) || 0));
    this.message = '';
    this.update();
  }

  getState() {
    return { balance: this.balance, isOpen: this.isOpen, selectionId: this.selection?.id ?? null };
  }

  render() {
    const selection = this.selection;
    const line = selection?.type === 'line';
    const full = line && selection.level >= MAX_LEVEL;
    const cost = line && !full ? selection.level * 100 : 0;
    const insufficient = line && !full && this.balance < cost;
    this.sheet.dataset.deviceId = selection?.id || '';
    this.sheet.dataset.level = line ? String(selection.level) : '';
    this.sheet.dataset.state = this.busy ? 'pending' : !line ? 'unavailable' : full ? 'max' : insufficient ? 'insufficient' : 'ready';
    this.nameElement.textContent = selection?.name || '尚未选择设备';
    this.balanceElement.textContent = String(this.balance);
    this.comparison.hidden = !line;
    this.wallet.hidden = !line;
    this.refill.hidden = !insufficient;
    this.refill.disabled = this.busy;
    this.submit.disabled = this.busy || !line || full || insufficient;
    this.targetElement.textContent = line ? '仅升级这条产线，其他设备等级保持不变。' : '服务范围';

    if (line) {
      this.currentLevel.textContent = `Lv.${selection.level}`;
      this.nextCaption.textContent = full ? '等级上限' : '升级后';
      this.nextLevel.textContent = full ? 'Lv.6' : `Lv.${selection.level + 1}`;
      this.effect.textContent = full ? '本线已达到演示等级上限。' : `预览效果：本线出厂等级提升至 Lv.${selection.level + 1}。`;
      this.submit.replaceChildren();
      if (full) this.submit.textContent = '已满级';
      else if (this.busy) this.submit.textContent = '正在升级…';
      else {
        this.submit.append(make('span', '', insufficient ? '示例币不足' : '升级本线'));
        const price = make('strong', '', `${cost} 示例币`);
        price.id = 'upgrade-cost';
        this.submit.append(price);
      }
    } else {
      const service = sharedServices[selection?.id];
      const slot = selection?.type === 'line-slot' || selection?.type === 'product-slot';
      this.effect.textContent = service
        ? `${service[1]}${Number.isFinite(selection.lineCount) ? `当前服务 ${selection.lineCount} 条已建产线。` : ''}`
        : slot ? '此机位尚未装配。返回场景完成扩建后，可选择本线升级。'
        : selection?.type === 'cache' ? '本线成品在此等待公共包装；请选中所属产线升级设备。'
        : '返回场景，选择已装配的产线后查看升级。';
      this.submit.textContent = service ? '公共设施暂不升级' : slot ? '请先装配产线' : '请选择产线';
    }
    this.status.textContent = insufficient ? `示例币不足，还差 ${cost - this.balance} 示例币。` : this.message || (full ? '可关闭返回场景，或选择其他产线。' : line ? '每级费用为当前等级 × 100 示例币。' : '本页仅演示产线等级升级。');
  }

  async upgrade() {
    if (this.busy) return;
    const shown = this.selection;
    const current = normalize(this.getSelection ? this.getSelection() : shown);
    if (current?.id !== shown?.id || current?.level !== shown?.level || current?.type !== shown?.type) {
      this.update(current);
      this.message = '设备状态已变化，请确认当前产线后再升级。';
      this.render();
      return;
    }
    if (current?.type !== 'line' || current.level >= MAX_LEVEL) return;
    const cost = current.level * 100;
    if (this.balance < cost) { this.render(); return; }
    this.busy = true;
    this.message = '';
    this.render();
    try {
      const accepted = await this.onUpgrade?.({ id: current.id, fromLevel: current.level, toLevel: current.level + 1, cost });
      if (accepted === false || !this.onUpgrade) {
        this.message = '设备状态已变化，未扣除示例币。请重新确认。';
      } else {
        this.balance -= cost;
        this.message = `${current.name} 已升至 Lv.${current.level + 1}，扣除 ${cost} 示例币。`;
      }
      this.update(this.getSelection ? this.getSelection() : current);
    } catch (error) {
      this.message = '此次升级未完成，未扣除示例币。请重试。';
      console.error(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  destroy() {
    this.close();
    this.host.removeEventListener('keydown', this.onKeyDown);
    this.sheet.remove();
  }
}
