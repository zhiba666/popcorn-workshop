import { runtimeFactoryAssetsById } from '../../assets/runtime/factory/v1/manifest.js';

const PERIOD = 12, SPEED = 90;
const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const amount = clamp(value); return amount * amount * (3 - 2 * amount); };
const plans = new WeakMap();
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const workshopLineOffset = line => line.index * 1.37 + (line.number - 1) * 2.3;

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

// Match the short, 42 px raised crossing already drawn by workshop-logistics.
// Motion climbs its two shoulders instead of cutting across the lower trunk.
function raisedRoute(points, bridges = []) {
  const result = [points[0]];
  for (const segment of measure(points).segments) {
    const crossings = bridges.map(bridge => {
      const dx = bridge.point[0] - segment.start[0], dy = bridge.point[1] - segment.start[1];
      return { at: dx * segment.unit[0] + dy * segment.unit[1],
        across: Math.abs(dx * segment.unit[1] - dy * segment.unit[0]) };
    }).filter(value => value.across < 2 && value.at > 8 && value.at < segment.length - 8)
      .sort((a, b) => a.at - b.at);
    const point = offset => [segment.start[0] + segment.unit[0] * offset,
      segment.start[1] + segment.unit[1] * offset];
    for (const crossing of crossings) {
      const reach = Math.min(21, crossing.at - 2, segment.length - crossing.at - 2);
      const start = point(crossing.at - reach), end = point(crossing.at + reach), shoulder = reach * .42;
      result.push(start, [start[0] + segment.unit[0] * shoulder, start[1] + segment.unit[1] * shoulder - 11],
        [end[0] - segment.unit[0] * shoulder, end[1] - segment.unit[1] * shoulder - 11], end);
    }
    result.push(segment.end);
  }
  return result;
}

function atDistance(metric, amount) {
  const segment = metric.segments.find(value => amount <= value.at + value.length) || metric.segments.at(-1);
  if (!segment) return null;
  const offset = Math.max(0, Math.min(segment.length, amount - segment.at));
  return { x: segment.start[0] + segment.unit[0] * offset,
    y: segment.start[1] + segment.unit[1] * offset, unit: segment.unit };
}

function planFor(layout) {
  if (plans.has(layout)) return plans.get(layout);
  const linePlans = layout.lines.map(line => {
    const branch = raisedRoute(line.returnRoute, line.bridges.filter(bridge => bridge.role === 'return'));
    const returnPoints = [...branch, ...layout.mainRoutes.return.slice(1), ...layout.shared.packer.feedRoute.slice(1)];
    return { line, output: measure(line.outputRoute), returning: measure(returnPoints),
      feeding: measure(raisedRoute(line.feedRoute, line.bridges.filter(bridge => bridge.role === 'feed'))) };
  });
  const packagingSeconds = Math.min(2.2, 9.6 / Math.max(1, linePlans.length));
  const events = [];
  // A fixed pre-roll settles the periodic packaging queue. Its size never grows
  // with play time; all travel distances, arrivals and press slots are cached.
  for (let cycle = -4; cycle <= 4; cycle++) for (const linePlan of linePlans) {
    const depart = cycle * PERIOD - workshopLineOffset(linePlan.line) + 9;
    events.push({ linePlan, depart, arrive: depart + linePlan.returning.total / SPEED });
  }
  events.sort((a, b) => a.arrive - b.arrive || a.linePlan.line.id.localeCompare(b.linePlan.line.id));
  let freeAt = -Infinity;
  for (const event of events) {
    event.packStart = Math.max(event.arrive, freeAt);
    event.packEnd = event.packStart + packagingSeconds;
    freeAt = event.packEnd;
  }
  const plan = { linePlans, events, packagingSeconds,
    shipping: measure(layout.mainRoutes.packToWarehouse),
    supply: [measure(layout.shared.supply.feedRoute), measure(layout.mainRoutes.supply)] };
  plans.set(layout, plan);
  return plan;
}

/** Deterministic, preview-only activity; there are no inventory or save writes. */
export function createWorkshopMotionState(layout, time) {
  const plan = planFor(layout), clock = modulo(time + PERIOD * 4, PERIOD);
  const lineStates = new Map(), transfers = [];
  for (const linePlan of plan.linePlans) {
    const line = linePlan.line, local = modulo(clock + workshopLineOffset(line), PERIOD);
    let phase = 'idle', progress = (local - 8) / 4;
    if (local < 2) { phase = 'feeding'; progress = local / 2; }
    else if (local < 6) { phase = 'processing'; progress = (local - 2) / 4; }
    else if (local < 8) { phase = 'discharging'; progress = (local - 6) / 2; }
    const cacheAmount = local < 8 ? 0 : local < 8.18 ? smooth((local - 8) / .18)
      : local < 9 ? 1 : local < 9.18 ? 1 - smooth((local - 9) / .18) : 0;
    lineStates.set(line.id, { phase, progress: clamp(progress), cacheAmount, product: line.product.id });
    const outputStart = Math.max(6, 8 - linePlan.output.total / SPEED);
    if (local >= outputStart && local < 8) transfers.push({ kind: 'output', product: line.product.id,
      lineId: line.id, metric: linePlan.output, progress: (local - outputStart) / (8 - outputStart) });
  }
  let pack = { active: false, progress: 0, product: layout.lines[0]?.product.id || 'original' };
  let shipment = { active: false, progress: 0, product: pack.product };
  let queued = 0;
  for (const event of plan.events) {
    const product = event.linePlan.line.product.id, lineId = event.linePlan.line.id;
    if (clock >= event.depart && clock < event.arrive) transfers.push({ kind: 'return', product, lineId,
      metric: event.linePlan.returning, progress: (clock - event.depart) / (event.arrive - event.depart) });
    else if (clock >= event.arrive && clock < event.packStart && queued < 4) transfers.push({ kind: 'queue', product,
      lineId, metric: event.linePlan.returning, distance: event.linePlan.returning.total - 7 - queued++ * 13 });
    if (clock >= event.packStart && clock < event.packEnd) pack = { active: true,
      progress: (clock - event.packStart) / plan.packagingSeconds, product };
    const shippingSeconds = plan.shipping.total / SPEED;
    if (clock >= event.packEnd && clock < event.packEnd + shippingSeconds) transfers.push({ kind: 'shipment',
      product, metric: plan.shipping, progress: (clock - event.packEnd) / shippingSeconds });
    const receivedAt = event.packEnd + shippingSeconds;
    if (clock >= receivedAt - .35 && clock < receivedAt + 1.4) shipment = {
      active: true, progress: clamp((clock - receivedAt + .35) / .7), product };
  }
  return { lineStates, pack, shipment, transfers };
}

function image(src) {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`场景动效资源未载入：${src.split('/').pop()}`));
    element.src = src;
  });
}

function opaqueBounds(element) {
  const canvas = document.createElement('canvas');
  canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(element, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 16) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return right > left ? [left, top, right - left, bottom - top] : [0, 0, width, height];
}

function visible(point, bounds) {
  if (!bounds) return true;
  const left = bounds.left ?? bounds.x ?? -Infinity, top = bounds.top ?? bounds.y ?? -Infinity;
  const right = bounds.right ?? left + bounds.w, bottom = bounds.bottom ?? top + bounds.h;
  return point.x > left - 24 && point.x < right + 24 && point.y > top - 24 && point.y < bottom + 24;
}

function paintProduct(context, resource, point, packaged) {
  const width = packaged ? 23 : 14, height = width * resource.bounds[3] / resource.bounds[2];
  const cappedHeight = Math.min(packaged ? 25 : 16, height), actualWidth = width * cappedHeight / height;
  context.save();
  context.fillStyle = '#66533b'; context.globalAlpha = .22;
  context.beginPath(); context.ellipse(point.x + 1, point.y + 2, packaged ? 8 : 5, 2, 0, 0, Math.PI * 2); context.fill();
  context.globalAlpha = 1;
  if (packaged) {
    context.fillStyle = '#fff1ce'; context.strokeStyle = '#927c4a'; context.lineWidth = .9;
    context.beginPath(); context.roundRect(point.x - actualWidth / 2 - 2, point.y - cappedHeight / 2 - 4,
      actualWidth + 4, cappedHeight + 3, 3); context.fill(); context.stroke();
  }
  context.drawImage(resource.image, ...resource.bounds, point.x - actualWidth / 2,
    point.y - cappedHeight / 2 - 3, actualWidth, cappedHeight);
  if (packaged) {
    context.strokeStyle = '#5b9b7b'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(point.x - actualWidth / 2 - 1, point.y + cappedHeight / 2 - 3);
    context.lineTo(point.x + actualWidth / 2 + 1, point.y + cappedHeight / 2 - 3); context.stroke();
  }
  context.restore();
}

/** One transparent transport layer, driven by the scene's existing frame loop. */
export async function createFlowMotion(world, layout) {
  const resources = new Map(), packagedResources = new Map(), productIds = [...new Set(layout.lines.map(line => line.product.id))];
  await Promise.all(productIds.map(async product => {
    const source = product === 'original' ? runtimeFactoryAssetsById['loose-popcorn']
      : product === 'caramel' ? runtimeFactoryAssetsById['caramel-popcorn'] : null;
    const packagedImage = await image(new URL(`../../assets/runtime/board/v1/products/${product}/lv-01.png`, import.meta.url).href);
    const packaged = { image: packagedImage, bounds: opaqueBounds(packagedImage) };
    packagedResources.set(product, packaged);
    if (source) {
      const element = await image(source.src);
      resources.set(product, { image: element, bounds: opaqueBounds(element) });
    } else resources.set(product, packaged);
  }));
  const canvas = document.createElement('canvas');
  canvas.className = 'workshop-flow-motion';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = layout.width; canvas.height = layout.height;
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: `${layout.width}px`,
    height: `${layout.height}px`, zIndex: '3', pointerEvents: 'none' });
  world.append(canvas);
  const context = canvas.getContext('2d'), plan = planFor(layout);
  let destroyed = false;
  return {
    draw(time, state, { overview = false, visibleRect, reducedMotion = false } = {}) {
      if (destroyed) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (reducedMotion) return;
      const pipes = [...plan.supply, ...plan.linePlans.filter(entry => state.lineStates.get(entry.line.id)?.phase === 'feeding').map(entry => entry.feeding)];
      context.strokeStyle = '#e0f1d9'; context.lineWidth = overview ? 3 : 2.4; context.lineCap = 'round';
      context.globalAlpha = overview ? .5 : .85;
      for (const metric of pipes) {
        const spacing = overview ? 195 : 115;
        for (let amount = modulo(time * 65, spacing); amount < metric.total; amount += spacing) {
          const point = atDistance(metric, amount);
          if (!point || !visible(point, visibleRect)) continue;
          context.beginPath(); context.moveTo(point.x - point.unit[0] * 3, point.y - point.unit[1] * 3);
          context.lineTo(point.x + point.unit[0] * 3, point.y + point.unit[1] * 3); context.stroke();
        }
      }
      context.globalAlpha = 1;
      const visibleTransfers = state.transfers.filter(transfer => !overview || transfer.kind !== 'queue');
      for (const [index, transfer] of visibleTransfers.entries()) {
        if (overview && visibleTransfers.length > 14 && index % 2) continue;
        const point = atDistance(transfer.metric, transfer.distance ?? transfer.metric.total * transfer.progress);
        const resource = (transfer.kind === 'shipment' ? packagedResources : resources).get(transfer.product);
        if (point && resource && visible(point, visibleRect)) paintProduct(context, resource, point, transfer.kind === 'shipment');
      }
    },
    destroy() { destroyed = true; canvas.remove(); resources.clear(); packagedResources.clear(); },
  };
}
