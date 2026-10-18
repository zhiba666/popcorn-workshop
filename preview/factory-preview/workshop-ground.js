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

function corners(layout, area) {
  return [[area.x, area.y], [area.x + area.w, area.y],
    [area.x + area.w, area.y + area.h], [area.x, area.y + area.h]]
    .map(point => layout.project(point));
}

function groundRect(parent, layout, area, className) {
  return element('polygon', { points: points(corners(layout, area)), class: className }, parent);
}

function line(parent, layout, values, className) {
  const path = values.map((point, index) => `${index ? 'L' : 'M'}${layout.project(point).join(' ')}`).join(' ');
  return element('path', { d: path, class: className }, parent);
}

function inset(area, amount) {
  return { x: area.x + amount, y: area.y + amount, w: area.w - amount * 2, h: area.h - amount * 2 };
}

// All floors share the same projected plane. Only their vertical edge depth
// changes; machine sprites continue to use their original upright projection.
function platform(parent, layout, area, className, depth = 12) {
  const node = element('g', { class: `ground-platform ${className}` }, parent);
  const [a, b, c, d] = corners(layout, area);
  const lower = point => [point[0], point[1] + depth];
  element('polygon', { points: points([a, b, c, d].map(point => [point[0] + 4, point[1] + depth + 5])),
    class: 'ground-platform-shadow' }, node);
  element('polygon', { points: points([b, c, lower(c), lower(b)]), class: 'ground-side-edge' }, node);
  element('polygon', { points: points([d, c, lower(c), lower(d)]), class: 'ground-front-edge' }, node);
  element('polygon', { points: points([a, b, c, d]), class: 'ground-platform-top' }, node);
  line(node, layout, [[area.x, area.y + area.h], [area.x + area.w, area.y + area.h]], 'ground-edge-highlight');
  return node;
}

function renderSpine(parent, layout) {
  const area = layout.spine.groundRect;
  const node = platform(parent, layout, area, 'ground-spine', 12);
  groundRect(node, layout, inset(area, 9), 'ground-spine-inset');
  // The two quiet strips reserve actual paving for the supply and return trunks.
  for (const fraction of [.29, .71]) {
    const x = area.x + area.w * fraction;
    line(node, layout, [[x, area.y + 16], [x, area.y + area.h - 18]], 'ground-service-guide');
  }
  const rowJoints = [...new Set(layout.groups.map(group =>
    group.groundRect.y + group.groundRect.h * .63))].sort((a, b) => a - b);
  for (const y of rowJoints) {
    if (y < area.y + 18 || y > area.y + area.h - 18) continue;
    line(node, layout, [[area.x + 12, y], [area.x + area.w - 12, y]], 'ground-paving-joint');
  }
}

function renderCourtyard(parent, layout) {
  const area = layout.courtyard.groundRect;
  const node = platform(parent, layout, area, 'ground-courtyard', 18);
  groundRect(node, layout, inset(area, 14), 'ground-courtyard-rim');
  const centerX = area.x + area.w / 2;
  // A broad work floor makes supply, packaging and storage read as one hub.
  // Joints stay around its margins rather than creating a separate box per asset.
  line(node, layout, [[area.x + 22, area.y + 42], [area.x + area.w - 22, area.y + 42]], 'ground-paving-joint');
  line(node, layout, [[area.x + 22, area.y + area.h - 58],
    [centerX - 102, area.y + area.h - 58]], 'ground-paving-joint');
  line(node, layout, [[centerX + 102, area.y + area.h - 58],
    [area.x + area.w - 22, area.y + area.h - 58]], 'ground-paving-joint');
  for (const x of [area.x + 110, area.x + area.w - 110]) {
    line(node, layout, [[x, area.y + 22], [x, area.y + 42]], 'ground-paving-joint');
    line(node, layout, [[x, area.y + area.h - 58], [x, area.y + area.h - 20]], 'ground-paving-joint');
  }
  // The entry notch and threshold establish the front of the site at every zoom.
  groundRect(node, layout, { x: centerX - 88, y: area.y + area.h - 52, w: 176, h: 52 }, 'ground-entry-lane');
  for (let index = 0; index < 3; index++) {
    groundRect(node, layout, { x: centerX - 68, y: area.y + area.h - 34 + index * 10, w: 136, h: 4 }, 'ground-entry-threshold');
  }
  for (const x of [centerX - 102, centerX + 102]) {
    groundRect(node, layout, { x: x - 9, y: area.y + area.h - 35, w: 18, h: 26 }, 'ground-entry-foot');
  }
}

function renderWorkshop(parent, layout, group) {
  const area = group.groundRect;
  const next = group.next || (!group.built && layout.next?.id === group.product.id);
  const state = group.built ? 'built' : next ? 'next' : 'locked';
  const node = platform(parent, layout, area, `ground-workshop ${state}`, group.built ? 10 : 5);
  node.dataset.workshop = group.product.id;
  groundRect(node, layout, inset(area, 12), 'ground-workshop-inset');
  const entryY = area.y + area.h * .63;
  const spine = layout.spine.groundRect;
  const connector = group.column === 0
    ? { x: area.x + area.w, y: entryY - 30, w: spine.x - area.x - area.w, h: 60 }
    : { x: spine.x + spine.w, y: entryY - 30, w: area.x - spine.x - spine.w, h: 60 };
  if (connector.w > 0) groundRect(node, layout, connector, 'ground-workshop-connector');
  if (group.built) {
    const insideX = group.column === 0 ? area.x + area.w - 30 : area.x + 30;
    line(node, layout, [[insideX, entryY - 28], [insideX, entryY + 28]], 'ground-workshop-threshold');
    // A pair of subtle rear/front joints follows the same ground axes as the
    // installations while leaving the large center surface calm.
    line(node, layout, [[area.x + 18, area.y + 34], [area.x + area.w - 18, area.y + 34]], 'ground-paving-joint');
    const accentX = group.column === 0 ? area.x + 18 : area.x + area.w - 31;
    groundRect(node, layout, { x: accentX, y: area.y + 16, w: 13, h: 56 }, 'ground-workshop-accent');
    node.style.setProperty('--workshop-ground-accent', ['#7eac8b', '#d1ac6e', '#b7a482', '#a3b2ca', '#c4937e', '#94aaa1'][group.index % 6]);
  }
}

function renderInstallationBases(parent, layout) {
  const bases = element('g', { class: 'ground-installation-bases' }, parent);
  const installations = [
    ...layout.slots.map(slot => ({ ...slot, shared: false })),
    ...Object.values(layout.shared).map(device => ({ ...device, built: true, shared: true })),
  ];
  installations.sort((a, b) => layout.project(a.groundAnchor)[1] - layout.project(b.groundAnchor)[1]);
  for (const installation of installations) {
    const [x, y] = installation.groundAnchor;
    const width = installation.width / .9 * 1.08;
    const area = { x: x - width / 2, y: y - 18, w: width, h: installation.shared ? 70 : 60 };
    const state = installation.built ? 'built' : installation.next ? 'next' : 'locked';
    const node = platform(bases, layout, area, `ground-installation-base ${state}`, 5);
    node.dataset.installation = installation.id;
    groundRect(node, layout, inset(area, 5), 'ground-installation-inset');
  }
}

export function renderWorkshopGround(world, layout) {
  const svg = element('svg', {
    class: 'workshop-ground-layer', width: layout.width, height: layout.height,
    viewBox: `0 0 ${layout.width} ${layout.height}`, 'aria-hidden': 'true', focusable: 'false',
  });
  // Rear structures render first. Their faces remain beneath the sprite and
  // logistics layers; no floor transforms or pointer targets affect gestures.
  const pads = element('g', { class: 'ground-workshop-pads' }, svg);
  for (const group of layout.groups) renderWorkshop(pads, layout, group);
  renderSpine(svg, layout);
  renderCourtyard(svg, layout);
  renderInstallationBases(svg, layout);
  world.append(svg);
  return svg;
}
