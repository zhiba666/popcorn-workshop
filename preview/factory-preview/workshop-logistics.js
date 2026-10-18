const NS = 'http://www.w3.org/2000/svg';

function node(tag, attributes = {}, parent) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (parent) parent.append(element);
  return element;
}

const rounded = value => Math.round(value * 100) / 100;
const pointText = point => `${rounded(point[0])} ${rounded(point[1])}`;
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function measure(points) {
  let total = 0;
  const segments = [];
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index], length = distance(start, end);
    if (length < .01) continue;
    segments.push({ start, end, length, at: total,
      unit: [(end[0] - start[0]) / length, (end[1] - start[1]) / length] });
    total += length;
  }
  return { segments, total };
}

function atDistance(metric, amount) {
  const segment = metric.segments.find(value => amount <= value.at + value.length) || metric.segments.at(-1);
  if (!segment) return null;
  const offset = Math.max(0, Math.min(segment.length, amount - segment.at));
  return { point: [segment.start[0] + segment.unit[0] * offset, segment.start[1] + segment.unit[1] * offset],
    unit: segment.unit, angle: Math.atan2(segment.unit[1], segment.unit[0]) * 180 / Math.PI };
}

function nearSegment(point, segment) {
  const delta = [point[0] - segment.start[0], point[1] - segment.start[1]];
  const offset = delta[0] * segment.unit[0] + delta[1] * segment.unit[1];
  const across = Math.abs(delta[0] * segment.unit[1] - delta[1] * segment.unit[0]);
  return across < 2 && offset > 8 && offset < segment.length - 8 ? offset : null;
}

// Only the short part of the crossing branch is lifted. The other trunk stays
// intact underneath, so a branch never erases an entire route with a white bed.
function routeGeometry(metric, crossings) {
  const commands = metric.segments.length ? [`M${pointText(metric.segments[0].start)}`] : [];
  const bridges = [];
  for (const segment of metric.segments) {
    const local = crossings.map(crossing => ({ crossing, offset: nearSegment(crossing.point, segment) }))
      .filter(value => value.offset != null).sort((a, b) => a.offset - b.offset);
    for (const { crossing, offset } of local) {
      const reach = Math.min(21, offset - 2, segment.length - offset - 2);
      const position = amount => [segment.start[0] + segment.unit[0] * amount, segment.start[1] + segment.unit[1] * amount];
      const start = position(offset - reach), end = position(offset + reach);
      commands.push(`L${pointText(start)}`, `M${pointText(end)}`);
      const lift = 11, shoulder = reach * .42;
      const upperStart = [start[0] + segment.unit[0] * shoulder, start[1] + segment.unit[1] * shoulder - lift];
      const upperEnd = [end[0] - segment.unit[0] * shoulder, end[1] - segment.unit[1] * shoulder - lift];
      bridges.push({ ...crossing, start, end, reach, at: segment.at + offset,
        d: `M${pointText(start)} L${pointText(upperStart)} L${pointText(upperEnd)} L${pointText(end)}` });
    }
    commands.push(`L${pointText(segment.end)}`);
  }
  return { d: commands.join(' '), bridges };
}

function localGroup(parent, point, angle, className) {
  return node('g', { class: className,
    transform: `translate(${pointText(point)}) rotate(${rounded(angle)})` }, parent);
}

function drawCollar(parent, location, width, pipe, connector = false) {
  const group = localGroup(parent, location.point, location.angle,
    `workshop-logistics-detail workshop-logistics-${connector ? 'connector' : 'collar'}`);
  node('rect', { x: connector ? -4 : -2.5, y: -width / 2 - 1.5,
    width: connector ? 8 : 5, height: width + 3, rx: 1.6,
    class: pipe ? 'pipe-collar' : 'track-collar' }, group);
  node('path', { d: `M-1 ${-width / 2} L-1 ${width / 2}`, class: 'collar-light' }, group);
}

function drawSkin(parent, d, pipe, bridge = false) {
  node('path', { d, class: 'route-selection' }, parent);
  node('path', { d, class: `route-shadow${bridge ? ' bridge-shadow' : ''}`,
    transform: 'translate(0 3)' }, parent);
  node('path', { d, class: 'route-edge' }, parent);
  node('path', { d, class: 'route-body' }, parent);
  node('path', { d, class: pipe ? 'pipe-light' : 'track-channel',
    ...(pipe ? { transform: 'translate(0 -1.6)' } : {}) }, parent);
}

function drawRoute(parent, specification, bridgeLayer) {
  const { points, role, tier = 'branch', lineId = '', shared = '', crossings = [] } = specification;
  if (!Array.isArray(points) || points.length < 2) return;
  const metric = measure(points);
  if (!metric.total) return;
  const pipe = role === 'feed', width = pipe ? (tier === 'trunk' ? 16 : 11) : tier === 'trunk' ? 20 : role === 'output' ? 12 : 15;
  const group = node('g', { class: 'workshop-logistics-route', 'data-role': role, 'data-tier': tier,
    'data-line-id': lineId, 'data-shared': shared, style: `--route-width:${width}px` }, parent);
  const geometry = routeGeometry(metric, crossings);
  const clearOfBridges = amount => geometry.bridges.every(bridge => Math.abs(bridge.at - amount) > bridge.reach + 9);
  const clearOfCorners = amount => metric.segments.every(segment => !segment.at || Math.abs(segment.at - amount) > 12);

  // Low saddle feet and transverse sleepers give the routes a ground contact.
  for (let amount = 48; amount < metric.total - 26; amount += tier === 'trunk' ? 142 : 100) {
    if (!clearOfBridges(amount) || !clearOfCorners(amount)) continue;
    const location = atDistance(metric, amount), support = localGroup(group,
      [location.point[0], location.point[1] + 4], location.angle, 'workshop-logistics-detail route-support');
    node('rect', { x: -4, y: -width / 2 - 4, width: 8, height: width + 8, rx: 2 }, support);
  }
  drawSkin(group, geometry.d, pipe);

  if (pipe) {
    for (let amount = 33; amount < metric.total - 20; amount += tier === 'trunk' ? 115 : 88) {
      if (clearOfBridges(amount) && clearOfCorners(amount)) drawCollar(group, atDistance(metric, amount), width, true);
    }
    for (const segment of metric.segments.slice(1)) {
      if (segment.length > 18 && clearOfBridges(segment.at + 10)) drawCollar(group, atDistance(metric, segment.at + 10), width, true);
    }
  } else {
    for (let amount = 13; amount < metric.total - 9; amount += tier === 'trunk' ? 24 : 19) {
      if (!clearOfBridges(amount) || !clearOfCorners(amount)) continue;
      const location = atDistance(metric, amount), roller = localGroup(group, location.point, location.angle,
        'workshop-logistics-detail track-roller');
      node('path', { d: `M0 ${-width / 2 + 3} L0 ${width / 2 - 3}` }, roller);
    }
  }

  const flowCount = tier === 'trunk' ? Math.min(3, Math.floor(metric.total / 150)) : metric.total > 75 ? 1 : 0;
  for (let index = 1; index <= flowCount; index++) {
    const amount = metric.total * index / (flowCount + 1);
    if (!clearOfBridges(amount) || !clearOfCorners(amount)) continue;
    const location = atDistance(metric, amount), flow = localGroup(group, location.point, location.angle,
      `route-flow${tier === 'trunk' ? '' : ' workshop-logistics-detail'}`);
    node('path', { d: 'M-2.5 -2.5 L.5 0 L-2.5 2.5' }, flow);
  }

  // End collars are partly tucked under equipment sprites, making the visible
  // pipe and trough terminate at a socket rather than a loose rounded stroke.
  if (tier !== 'trunk') {
    drawCollar(group, atDistance(metric, Math.min(3, metric.total / 2)), width, pipe, true);
    drawCollar(group, atDistance(metric, Math.max(0, metric.total - 3)), width, pipe, true);
  }

  for (const bridge of geometry.bridges) {
    const bridgeGroup = node('g', { class: 'workshop-logistics-route workshop-logistics-bridge', 'data-role': role,
      'data-tier': tier, 'data-line-id': lineId, 'data-shared': shared,
      style: `--route-width:${width}px` }, bridgeLayer);
    for (const point of [bridge.start, bridge.end]) node('path', {
      d: `M${pointText(point)} l0 6`, class: 'bridge-foot' }, bridgeGroup);
    drawSkin(bridgeGroup, bridge.d, pipe, true);
    drawCollar(bridgeGroup, { point: bridge.start, angle: Math.atan2(
      bridge.end[1] - bridge.start[1], bridge.end[0] - bridge.start[0]) * 180 / Math.PI }, width, pipe);
    drawCollar(bridgeGroup, { point: bridge.end, angle: Math.atan2(
      bridge.end[1] - bridge.start[1], bridge.end[0] - bridge.start[0]) * 180 / Math.PI }, width, pipe);
  }
}

/** Render static, physical route pieces beneath the equipment sprites. */
export function renderWorkshopLogistics(world, layout) {
  const svg = node('svg', { class: 'workshop-logistics', viewBox: `0 0 ${layout.width} ${layout.height}`,
    'aria-hidden': 'true', focusable: 'false' });
  const routes = node('g', { class: 'workshop-logistics-routes' }, svg);
  const bridges = node('g', { class: 'workshop-logistics-bridges' }, svg);
  const draw = specification => drawRoute(routes, specification, bridges);
  draw({ points: layout.mainRoutes.supply, role: 'feed', tier: 'trunk', shared: 'supply' });
  draw({ points: layout.mainRoutes.return, role: 'return', tier: 'trunk', shared: 'packer' });
  draw({ points: layout.mainRoutes.packToWarehouse, role: 'return', tier: 'trunk', shared: 'packer warehouse' });
  for (const line of layout.lines) {
    const common = { lineId: line.id };
    draw({ ...common, points: line.feedRoute, role: 'feed',
      crossings: (line.bridges || []).filter(bridge => bridge.role === 'feed') });
    draw({ ...common, points: line.outputRoute, role: 'output' });
    draw({ ...common, points: line.returnRoute, role: 'return',
      crossings: (line.bridges || []).filter(bridge => bridge.role === 'return') });
  }
  draw({ points: layout.shared.supply.feedRoute, role: 'feed', shared: 'supply' });
  draw({ points: layout.shared.packer.feedRoute, role: 'return', shared: 'packer' });
  world.append(svg);
  return svg;
}

/** Selection uses the same owner id for a line and its independent cache. */
export function updateWorkshopLogistics(svg, selectionId) {
  if (!svg) return;
  const owner = String(selectionId || '').replace(/-buffer$/, '');
  let selected = false;
  for (const group of svg.querySelectorAll('.workshop-logistics-route')) {
    const active = !!owner && (group.dataset.lineId === owner || group.dataset.shared.split(' ').includes(owner));
    group.classList.toggle('is-selected', active);
    selected ||= active;
  }
  svg.classList.toggle('has-route-selection', selected);
  svg.dataset.selectionId = owner;
}
