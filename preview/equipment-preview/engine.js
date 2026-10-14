const COMMON_FORMS = [
  { id: 'cycle', label: '完整循环' },
  { id: 'empty', label: '空机' },
  { id: 'feeding', label: '进料' },
  { id: 'processing', label: '加工' },
  { id: 'discharging', label: '出料' },
];

export function getAnimationForms(rig) {
  const forms = COMMON_FORMS.map(form => ({ ...form }));
  if (rig.layers.some(layer => layer.motion?.type === 'press')) forms.push({ id: 'press', label: '合模' });
  if (rig.flipAssembly) forms.push({ id: 'open', label: '开盖' }, { id: 'closed', label: '闭盖' }, { id: 'flip', label: '整排翻面' });
  if (rig.indexedTable) forms.push({ id: 'index', label: '转盘转位' });
  return forms;
}

export class AnimationTimeline {
  constructor(rig) {
    this.rig = rig;
    this.ready = false;
    this.error = '';
    this.form = 'cycle';
    this.cycleIndex = 0;
    this.loopIndex = 0;
    this._clock = 0;
    this._windowStart = 0;
    this._windowSeconds = this.totalSeconds;
    this._static = false;
    this._input = true;
    this._indexes = true;
    if (rig.indexedTable) {
      this._windowStart = this.phaseStart('processing');
      this._windowSeconds = rig.phases.find(phase => phase.id === 'processing').seconds;
    }
  }
  get totalSeconds() { return this.rig.phases.reduce((sum, phase) => sum + phase.seconds, 0); }
  get duration() { return this._windowSeconds; }
  get elapsed() { return this._windowStart + this._clock; }
  get progress() { return this._clock / this._windowSeconds; }
  get playbackTime() { return this.loopIndex * this._windowSeconds + this._clock; }
  get motionTime() { return this.loopIndex * this._windowSeconds + this.elapsed; }
  get inFlight() { return this.ready && !this.error && !this._static; }
  get hasInput() { return this.inFlight && this._input; }
  get phase() {
    let start = 0;
    for (let index = 0; index < this.rig.phases.length; index++) {
      const phase = this.rig.phases[index];
      if (this.elapsed < start + phase.seconds || index === this.rig.phases.length - 1) {
        const elapsed = Math.max(0, Math.min(phase.seconds, this.elapsed - start));
        return { ...phase, index, elapsed, progress: elapsed / phase.seconds };
      }
      start += phase.seconds;
    }
  }
  phaseStart(id) {
    let start = 0;
    for (const phase of this.rig.phases) { if (phase.id === id) return start; start += phase.seconds; }
    return 0;
  }
  setForm(id) {
    const supported = getAnimationForms(this.rig).some(form => form.id === id);
    this.form = supported ? id : 'cycle';
    this.cycleIndex = 0;
    this.loopIndex = 0;
    this._clock = 0;
    this._windowStart = 0;
    this._windowSeconds = this.totalSeconds;
    this._static = this.form === 'empty' || this.form === 'open';
    this._input = !['empty', 'open', 'closed', 'flip'].includes(this.form);
    this._indexes = this.form === 'cycle' || this.form === 'processing' || this.form === 'index';
    const stage = this.form === 'press' ? 'processing' : this.form;
    const phase = this.rig.phases.find(item => item.id === stage);
    if (phase) { this._windowStart = this.phaseStart(phase.id); this._windowSeconds = phase.seconds; }
    if (this.form === 'cycle' && this.rig.indexedTable) {
      // All four workstations operate during the same dwell, followed by one index.
      this._windowStart = this.phaseStart('processing');
      this._windowSeconds = this.rig.phases.find(item => item.id === 'processing').seconds;
    }
    if (this.form === 'closed') {
      const motion = this.rig.layers.find(layer => layer.closedSource)?.motion;
      const hold = motion.hold;
      const travel = (motion.duration - hold) / 2;
      this._windowStart = this.phaseStart(motion.phase) + (motion.delay || 0) + travel + .01;
      this._windowSeconds = Math.max(.1, hold - .02);
    }
    if (this.form === 'flip') {
      const assembly = this.rig.flipAssembly;
      this._windowStart = this.phaseStart(assembly.phase) + assembly.delay;
      this._windowSeconds = assembly.duration;
    }
    if (this.form === 'index') {
      const table = this.rig.indexedTable;
      this._windowStart = this.phaseStart('processing') + table.delay;
      this._windowSeconds = table.duration;
    }
    return this.form;
  }
  advance(seconds) {
    if (!this.ready || this.error || this._static || !Number.isFinite(seconds) || seconds <= 0) return false;
    const time = this._clock + seconds;
    const wraps = Math.floor(time / this._windowSeconds);
    this._clock = time % this._windowSeconds;
    this.loopIndex += wraps;
    if (this._indexes) this.cycleIndex += wraps;
    return true;
  }
}
