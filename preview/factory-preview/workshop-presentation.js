const NS = 'http://www.w3.org/2000/svg';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const intersection = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// Labels live in viewport pixels; the artwork retains its world depth order.
export class WorkshopPresentation {
  constructor(viewport, world) {
    this.viewport = viewport;
    this.world = world;
    this.badges = new Map();
    this.showBadges = false;
    this.host = document.createElement('div');
    this.host.className = 'scene-presentation';
    this.host.setAttribute('aria-hidden', 'true');
    this.leader = document.createElementNS(NS, 'svg');
    this.leader.classList.add('scene-selection-leader');
    this.leaderPath = document.createElementNS(NS, 'path');
    this.leader.append(this.leaderPath);
    this.callout = document.createElement('div');
    this.callout.className = 'scene-selection-callout';
    this.title = document.createElement('strong');
    this.subtitle = document.createElement('span');
    this.callout.append(this.title, this.subtitle);
    this.host.append(this.leader, this.callout);
    viewport.append(this.host);
  }

  update({ nodes, selected, layout, camera, state, overview, workshopView, levels, safeBottom, overviewLabels }) {
    if (!camera || !state || !selected) { this.host.hidden = true; return; }
    this.host.hidden = overview;
    const owner = selected.type === 'cache' ? selected.lineId : selected.id;
    const productId = selected.product?.id;
    for (const node of nodes.values()) {
      node.element.classList.toggle('is-context', !!productId && node.product?.id === productId);
      node.element.classList.toggle('is-paired', node.id !== selected.id &&
        (node.id === owner || node.lineId === owner));
      node.element.classList.toggle('is-selected', node.id === selected.id);
    }
    this.world.classList.toggle('has-scene-context', !!productId);
    for (const ground of this.world.querySelectorAll('[data-workshop]'))
      ground.classList.toggle('is-focused', ground.dataset.workshop === productId);
    for (const base of this.world.querySelectorAll('[data-installation],[data-cache-pad]'))
      base.classList.toggle('is-selected-base', (base.dataset.installation || base.dataset.cachePad) === owner);
    for (const { button, group } of overviewLabels.values())
      button.setAttribute('aria-pressed', String(group.product.id === productId));

    const width = this.viewport.clientWidth, height = Math.max(0, Math.min(this.viewport.clientHeight, safeBottom));
    const visible = { x: 0, y: 0, w: width, h: height };
    const screenRect = node => {
      const origin = camera.worldToViewport({ x: node.left, y: node.top });
      return { x: origin.x, y: origin.y, w: node.width * state.zoom, h: node.height * state.zoom };
    };
    if (workshopView && !overview) this.showBadges = true;
    else if (overview || state.zoom <= .56) this.showBadges = false;
    else if (state.zoom >= .62) this.showBadges = true;
    const live = new Set();
    for (const node of nodes.values()) {
      if (node.type !== 'line' && node.type !== 'shared') continue;
      live.add(node.id);
      let badge = this.badges.get(node.id);
      if (!badge) {
        badge = document.createElement('span'); badge.className = 'scene-line-index';
        this.host.append(badge); this.badges.set(node.id, badge);
      }
      const box = screenRect(node);
      const facility = node.type === 'shared';
      badge.classList.toggle('scene-facility-index', facility);
      badge.textContent = facility ? node.name.replace('公共', '').replace('统一', '') : `${node.number}号`;
      badge.hidden = !(facility ? selected.type === 'shared' : this.showBadges && node.product.id === productId) ||
        node.id === selected.id || intersection(box, visible) < box.w * box.h * .35;
      badge.style.left = `${clamp(facility ? box.x + box.w / 2 : box.x + box.w - 14, 20, width - 20)}px`;
      badge.style.top = `${clamp(facility ? box.y + box.h + 9 : box.y + 9, 12, height - 12)}px`;
    }
    for (const [id, badge] of this.badges) if (!live.has(id)) { badge.remove(); this.badges.delete(id); }

    const target = screenRect(selected);
    const targetVisible = intersection(target, visible);
    const hide = overview || height < 78 || targetVisible < Math.min(target.w * target.h * .2, 160);
    this.callout.hidden = hide; this.leader.toggleAttribute('hidden', hide);
    if (hide) return;
    const level = levels.get(owner) || 1;
    const compact = width < 350;
    const name = compact && selected.product ? selected.product.name +
      (selected.type === 'cache' ? '缓存' : selected.type.endsWith('slot') ? '工坊' : '')
      : selected.type === 'cache' ? `${selected.product.name} · ${selected.name}` : selected.name;
    const description = selected.type === 'line' ? compact ? `${selected.number}号线 · Lv.${level}` : `Lv.${level} · 独立缓存`
      : selected.type === 'cache' ? `所属${nodes.get(owner)?.number || 1}号线 · Lv.${level}`
      : selected.type === 'product-slot' ? compact ? '下一扩建 · 首线待建' : '下一处扩建 · 首条产线'
      : selected.type === 'line-slot' ? compact ? `${selected.number}号机位待建` : '本坊预留 · 可增开产线'
      : compact ? `服务${layout.lines.length}条产线` : `公共设施 · 服务${layout.lines.length}条线`;
    if (this.title.textContent !== name) this.title.textContent = name;
    if (this.subtitle.textContent !== description) this.subtitle.textContent = description;

    const w = Math.min(compact ? 112 : 138, width - 20), h = 46, gap = 10;
    const middleX = target.x + target.w / 2, middleY = target.y + target.h / 2;
    const right = { x: target.x + target.w + gap, y: target.y + 8 };
    const left = { x: target.x - w - gap, y: target.y + 8 };
    const candidates = [
      ...(selected.product && layout.groups.find(group => group.product.id === productId)?.column === 1 ? [left, right] : [right, left]),
      { x: middleX - w / 2, y: target.y - h - gap },
      { x: middleX - w / 2, y: target.y + target.h + gap },
      { x: right.x, y: target.y - h - gap }, { x: left.x, y: target.y - h - gap },
      { x: 10, y: 10 }, { x: width - w - 10, y: 10 },
    ];
    const obstacles = [...nodes.values()].filter(node => node.id !== selected.id &&
      (node.type === 'line' || node.type === 'cache' || node.type === 'shared')).map(screenRect);
    const scored = candidates.map((candidate, index) => {
      const box = { x: clamp(candidate.x, 10, width - w - 10), y: clamp(candidate.y, 10, height - h - 10), w, h };
      const obstacleOverlap = obstacles.reduce((sum, obstacle) => sum + intersection(box, obstacle), 0);
      const score = intersection(box, target) * 100 + obstacleOverlap * 4 +
        Math.hypot(box.x + w / 2 - middleX, box.y + h / 2 - middleY) * .2 + index;
      return { box, score, index, obstacleOverlap, ownOverlap: intersection(box, target) };
    });
    const local = scored.filter(candidate => candidate.index < 6 && candidate.ownOverlap <= h);
    const placement = (local.length ? local : scored).sort((a, b) => a.score - b.score)[0];
    // The fixed detail panel remains the label when a crowded edge leaves no
    // clear place for an extra callout. Never cover another device to fit it.
    if (placement.obstacleOverlap > 96 || placement.ownOverlap > h) {
      this.callout.hidden = true; this.leader.setAttribute('hidden', ''); return;
    }
    const box = placement.box;
    Object.assign(this.callout.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${w}px` });
    const center = { x: box.x + w / 2, y: box.y + h / 2 };
    const from = { x: clamp(middleX, box.x, box.x + w), y: clamp(middleY, box.y, box.y + h) };
    const to = { x: clamp(center.x, target.x, target.x + target.w), y: clamp(center.y, target.y, target.y + target.h) };
    this.leader.setAttribute('viewBox', `0 0 ${width} ${this.viewport.clientHeight}`);
    this.leaderPath.setAttribute('d', `M${from.x} ${from.y} L${to.x} ${to.y}`);
  }
}
