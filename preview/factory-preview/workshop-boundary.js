const SVG_NS = 'http://www.w3.org/2000/svg';

function element(name, attributes = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
}

function points(values) {
  return values.map(point => point.map(value => Number(value.toFixed(2))).join(',')).join(' ');
}

// A segment owns a small SVG and one depth value. A foreground rail can then
// occlude the foot of an object behind it without lifting the site's entire
// perimeter in front of every machine.
function segment(world, layout, from, to, { rail = false, state = 'built', kind = 'workshop' } = {}) {
  const a = layout.project(from), b = layout.project(to), depth = state === 'next' ? 3 : 6;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const offset = [-(b[1] - a[1]) / length * 4, (b[0] - a[0]) / length * 4];
  const c = [b[0] + offset[0], b[1] + offset[1]], d = [a[0] + offset[0], a[1] + offset[1]];
  const minX = Math.min(a[0], b[0], c[0], d[0]) - 6;
  const minY = Math.min(a[1], b[1]) - (rail ? 21 : 2);
  const maxX = Math.max(a[0], b[0], c[0], d[0]) + 6;
  const maxY = Math.max(a[1], b[1], c[1], d[1]) + depth + 5;
  const node = element('svg', { class: `workshop-boundary ${state} boundary-${kind}`,
    width: maxX - minX, height: maxY - minY, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
    'aria-hidden': 'true', focusable: 'false' });
  Object.assign(node.style, { left: `${minX}px`, top: `${minY}px`,
    zIndex: String(100 + Math.round(Math.max(a[1], b[1]))) });
  node.dataset.depth = String(Math.round(Math.max(a[1], b[1])));
  element('polygon', { points: points([a, b, c, d].map(point => [point[0] + 2, point[1] + depth + 2])),
    class: 'boundary-shadow' }, node);
  element('polygon', { points: points([d, c, [c[0], c[1] + depth], [d[0], d[1] + depth]]),
    class: 'boundary-curb-face' }, node);
  element('polygon', { points: points([a, b, c, d]), class: 'boundary-curb-top' }, node);
  if (rail) {
    element('path', { d: `M${a[0]} ${a[1] - 13}L${b[0]} ${b[1] - 13}`, class: 'boundary-rail' }, node);
    const count = Math.max(1, Math.ceil(length / 100));
    for (let index = 0; index <= count; index++) {
      const t = index / count, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      element('path', { d: `M${x + 2} ${y + 1}L${x + 2} ${y - 18}`, class: 'boundary-post-shadow' }, node);
      element('path', { d: `M${x} ${y}L${x} ${y - 18}`, class: 'boundary-post' }, node);
      element('circle', { cx: x, cy: y - 18, r: 2.6, class: 'boundary-post-cap' }, node);
    }
  }
  world.append(node);
  return node;
}

export function renderWorkshopBoundary(world, layout) {
  const nodes = [];
  const add = (from, to, options) => nodes.push(segment(world, layout, from, to, options));
  const spine = layout.spine.groundRect;
  const rearY = Math.min(...layout.groups.map(group => group.groundRect.y)) - 14;
  const left = Math.min(...layout.groups.map(group => group.groundRect.x));
  const right = Math.max(...layout.groups.map(group => group.groundRect.x + group.groundRect.w));
  // Rear retaining edges frame the far end, while the spine remains open.
  add([left, rearY], [spine.x - 18, rearY], { kind: 'rear' });
  add([spine.x + spine.w + 18, rearY], [right, rearY], { kind: 'rear' });
  add([left, rearY], [left + 152, rearY], { rail: true, kind: 'rear' });
  add([right - 152, rearY], [right, rearY], { rail: true, kind: 'rear' });
  for (const group of layout.groups) {
    if (!group.built && !group.next) continue;
    const area = group.groundRect, state = group.built ? 'built' : 'next';
    const outerX = group.column === 0 ? area.x - 5 : area.x + area.w + 5;
    // Only the outside receives a short guardrail. The entire service-side
    // entrance stays open towards the central spine and its pipe connections.
    add([outerX, area.y + 32], [outerX, area.y + area.h - 20], { state });
    if (group.built) add([outerX, area.y + 58], [outerX, area.y + 178], { state, rail: true });
    const outerStart = group.column === 0 ? area.x : area.x + area.w - 134;
    add([outerStart, area.y + area.h], [outerStart + 134, area.y + area.h], { state });
  }
  const court = layout.courtyard.groundRect, frontY = court.y + court.h + 3;
  const entryX = court.x + court.w / 2, entryHalf = 106;
  // The front landing is one courtyard, with an obvious opening rather than a
  // fence across the visitor's route. Its low edges establish the foreground.
  add([court.x - 5, court.y + 36], [court.x - 5, court.y + court.h], { kind: 'courtyard' });
  add([court.x + court.w + 5, court.y + 36], [court.x + court.w + 5, court.y + court.h], { kind: 'courtyard' });
  add([court.x, frontY], [entryX - entryHalf, frontY], { kind: 'courtyard' });
  add([entryX + entryHalf, frontY], [court.x + court.w, frontY], { kind: 'courtyard' });
  add([court.x + 18, frontY], [court.x + 178, frontY], { rail: true, kind: 'courtyard' });
  add([court.x + court.w - 178, frontY], [court.x + court.w - 18, frontY], { rail: true, kind: 'courtyard' });
  return nodes;
}
