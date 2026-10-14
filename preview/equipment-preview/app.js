import { MACHINE_RIGS } from '../../assets/source/gameplay/machines/animation/v1/rigs.js';
import { AnimationTimeline, getAnimationForms } from './engine.js';
import { EquipmentRenderer } from './renderer.js';

const $ = selector => document.querySelector(selector);
const machines = MACHINE_RIGS.map(rig => ({
  rig, timeline: new AnimationTimeline(rig), renderer: new EquipmentRenderer(rig),
  forms: getAnimationForms(rig), form: 'cycle',
}));
const cards = [];
let selectedIndex = 0;
let view = window.matchMedia('(max-width:720px)').matches ? 'focus' : 'overview';
let lastTime = 0;
let lastUiTime = 0;

function selected() { return machines[selectedIndex]; }
function formLabel(entry) { return entry.forms.find(form => form.id === entry.form)?.label || '运行循环'; }
function setView(next) {
  view = next;
  $('#machine-grid').hidden = next !== 'overview';
  $('#focus-scene').hidden = next !== 'focus';
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === next)));
}
function updateLabels() {
  machines.forEach((entry, index) => {
    const { timeline } = entry;
    const card = cards[index];
    card.form.textContent = timeline.error ? '未加载' : timeline.ready ? formLabel(entry) : '载入中';
    card.error.textContent = timeline.error ? '动画资源未加载' : '';
    card.root.dataset.form = entry.form;
    card.root.dataset.ready = String(timeline.ready);
    card.root.dataset.elapsed = String(timeline.elapsed);
    card.root.dataset.cycleIndex = String(timeline.cycleIndex);
  });
  $('#focus-form').textContent = selected().timeline.error ? '动画资源未加载' : formLabel(selected());
}
function renderSelection() {
  const entry = selected();
  $('#machine-select').value = String(selectedIndex);
  $('#focus-name').textContent = entry.rig.name;
  $('#form-options').replaceChildren(...entry.forms.map(form => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = form.label; button.dataset.form = form.id;
    button.setAttribute('aria-pressed', String(entry.form === form.id));
    button.addEventListener('click', () => {
      entry.form = entry.timeline.setForm(form.id);
      renderSelection();
    });
    return button;
  }));
  cards.forEach((card, index) => card.root.setAttribute('aria-pressed', String(index === selectedIndex)));
  updateLabels();
}
function selectMachine(index) { selectedIndex = index; renderSelection(); }

machines.forEach((entry, index) => {
  const root = document.createElement('button');
  root.type = 'button'; root.className = 'machine-card'; root.setAttribute('aria-label', `选择${entry.rig.name}`);
  const heading = document.createElement('div'); heading.className = 'card-heading';
  const number = document.createElement('span'); number.className = 'machine-number'; number.textContent = String(index + 1).padStart(2, '0');
  const name = document.createElement('span'); name.className = 'card-name'; name.textContent = entry.rig.name;
  const form = document.createElement('span'); form.className = 'card-form'; form.textContent = '载入中';
  heading.append(number, name, form);
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', `${entry.rig.name}动画`);
  const error = document.createElement('span'); error.className = 'card-error';
  root.append(heading, canvas, error);
  root.addEventListener('click', () => selectMachine(index));
  $('#machine-grid').append(root);
  cards.push({ root, canvas, form, error });
  const option = document.createElement('option'); option.value = String(index); option.textContent = entry.rig.name;
  $('#machine-select').append(option);
});

$('#machine-select').addEventListener('change', event => selectMachine(Number(event.target.value)));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.addEventListener('visibilitychange', () => { lastTime = 0; });

function frame(time) {
  const delta = lastTime ? Math.min((time - lastTime) / 1000, .08) : 0;
  lastTime = time;
  if (!document.hidden) machines.forEach(entry => entry.timeline.advance(delta));
  if (view === 'overview') machines.forEach((entry, index) => entry.renderer.draw(cards[index].canvas, entry.timeline));
  else { const entry = selected(); entry.renderer.draw($('#focus-canvas'), entry.timeline, { focus: true }); }
  if (time - lastUiTime > 100) { updateLabels(); lastUiTime = time; }
  requestAnimationFrame(frame);
}

setView(view); renderSelection(); requestAnimationFrame(frame);
await Promise.allSettled(machines.map(async entry => {
  try { await entry.renderer.load(); entry.timeline.ready = true; }
  catch (error) { entry.timeline.error = error.message; console.error(error); }
}));
updateLabels();
