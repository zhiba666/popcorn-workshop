// Isolated artwork demonstration. These timings and capacities are display
// parameters, not the game's production balance or public capacity policy.
export const PREVIEW_RULES = Object.freeze({
  stepSeconds: 0.05,
  batchUnits: 1,
  supplyCapacity: 12,
  refillEverySeconds: 1.75,
  refillUnits: 1,
  cacheCapacity: 2,
  packagingQueueCapacity: 4,
  feedingSeconds: 1.25,
  processingSeconds: Object.freeze({ original: 5.2, caramel: 6.2 }),
  dischargeSeconds: 1.1,
  cacheTransferSeconds: 1.3,
  packagingSeconds: 2.8,
  backlogPackagingSeconds: 14,
  productTransferSeconds: 1.5,
  accelerateSeconds: 2,
});

export const PREVIEW_SCENARIOS = Object.freeze(['normal', 'shortage', 'packaging-backlog', 'cache-full']);

const clamp = value => Math.max(0, Math.min(1, value));
const publicBatch = batch => batch ? { ...batch } : null;
const activePhases = ['feeding', 'processing', 'discharge'];

export class FactoryPreviewModel {
  constructor({ scenario = 'normal' } = {}) {
    this.time = 0;
    this.scenario = 'normal';
    this._nextBatch = 1;
    this._nextEvent = 1;
    this._events = [];
    this._supply = PREVIEW_RULES.supplyCapacity;
    this._refillElapsed = 0;
    this._refillEnabled = true;
    this._packagingPaused = false;
    this._queue = [];
    this._inbound = [];
    this._packaging = { phase: 'ready', batch: null, elapsed: 0, duration: 0 };
    this._lines = [
      { id: 'original-1', name: '原味 · 1号线', product: 'original', phase: 'ready', heldPhase: null, batch: null, elapsed: 0, duration: 0, cache: [], inventory: 0, completed: 0 },
      { id: 'caramel-1', name: '焦糖 · 1号线', product: 'caramel', phase: 'ready', heldPhase: null, batch: null, elapsed: 0, duration: 0, cache: [], inventory: 0, completed: 0 },
    ];
    if (scenario === 'shortage') {
      // An existing batch demonstrates that loss of supply does not cancel work.
      const line = this._lines[0];
      line.batch = this._newBatch(line, true);
      this._setLinePhase(line, 'processing');
      line.elapsed = line.duration * 0.35;
    }
    this.setScenario(scenario);
  }

  _newBatch(line, seeded = false) {
    return {
      id: `batch-${this._nextBatch++}`,
      lineId: line.id,
      product: line.product,
      units: PREVIEW_RULES.batchUnits,
      seeded,
    };
  }

  _event(type, batch = null) {
    this._events.push({ id: this._nextEvent++, time: this.time, type, batchId: batch?.id ?? null, lineId: batch?.lineId ?? null });
    if (this._events.length > 24) this._events.shift();
  }

  _setLinePhase(line, phase) {
    line.phase = phase;
    line.heldPhase = null;
    line.elapsed = 0;
    line.duration = phase === 'feeding' ? PREVIEW_RULES.feedingSeconds
      : phase === 'processing' ? PREVIEW_RULES.processingSeconds[line.product]
      : phase === 'discharge' ? PREVIEW_RULES.dischargeSeconds : 0;
  }

  _seedPending() {
    // Scenario samples represent batches that existed before this scene opened.
    // They enter inventory only after packaging and warehouse transport finish.
    const queueTarget = this.scenario === 'cache-full' ? PREVIEW_RULES.packagingQueueCapacity : 3;
    while (this._queue.length + this._inbound.length < queueTarget) {
      const line = this._lines[this._queue.length % this._lines.length];
      this._queue.push(this._newBatch(line, true));
    }
    const cacheTarget = this.scenario === 'cache-full' ? PREVIEW_RULES.cacheCapacity : 1;
    for (const line of this._lines) {
      while (line.cache.length < cacheTarget) line.cache.push(this._newBatch(line, true));
    }
  }

  setScenario(name) {
    if (!PREVIEW_SCENARIOS.includes(name)) throw new RangeError(`Unknown factory preview scenario: ${name}`);
    const changed = name !== this.scenario;
    this.scenario = name;
    this._refillEnabled = name !== 'shortage';
    this._packagingPaused = name === 'cache-full';
    if (name === 'shortage') {
      this._supply = 0;
      this._refillElapsed = 0;
    } else if (name === 'normal') {
      this._supply = PREVIEW_RULES.supplyCapacity;
      this._refillElapsed = 0;
    }
    if (changed && (name === 'packaging-backlog' || name === 'cache-full')) this._seedPending();
    if (this._packaging.phase === 'packaging') {
      const progress = this._packaging.elapsed / this._packaging.duration;
      this._packaging.duration = this._packagingDuration();
      this._packaging.elapsed = progress * this._packaging.duration;
    }
    this._event(`scenario:${name}`);
    this._settle();
    return this.snapshot();
  }

  _packagingDuration() {
    return this.scenario === 'packaging-backlog' ? PREVIEW_RULES.backlogPackagingSeconds : PREVIEW_RULES.packagingSeconds;
  }

  _settle() {
    // Hold the current pose and progress until the destination has room.
    // A completed processing phase must still perform its real discharge.
    for (const line of this._lines) {
      if (line.phase === 'waitingPackaging' && line.batch) {
        if (line.cache.length >= PREVIEW_RULES.cacheCapacity) continue;
        line.phase = line.heldPhase;
        line.heldPhase = null;
      }
      if (line.phase === 'feeding' && line.elapsed >= line.duration) this._setLinePhase(line, 'processing');
      if (line.phase === 'processing' && line.elapsed >= line.duration) {
        if (line.cache.length >= PREVIEW_RULES.cacheCapacity) {
          line.heldPhase = line.phase;
          line.phase = 'waitingPackaging';
        } else {
          this._setLinePhase(line, 'discharge');
        }
      }
      if (line.phase === 'discharge') {
        if (line.cache.length >= PREVIEW_RULES.cacheCapacity) {
          line.heldPhase = line.phase;
          line.phase = 'waitingPackaging';
        } else if (line.elapsed >= line.duration) {
          line.cache.push(line.batch);
          this._event('cached', line.batch);
          line.batch = null;
          this._setLinePhase(line, 'ready');
        }
      }
    }

    if (this._packaging.phase === 'packaging' && this._packaging.elapsed >= this._packaging.duration) {
      this._packaging.phase = 'productTransfer';
      this._packaging.elapsed = 0;
      this._packaging.duration = PREVIEW_RULES.productTransferSeconds;
      this._event('packaged', this._packaging.batch);
    }
    if (this._packaging.phase === 'productTransfer' && this._packaging.elapsed >= this._packaging.duration) {
      const batch = this._packaging.batch;
      const line = this._lines.find(entry => entry.id === batch.lineId);
      line.inventory += batch.units;
      line.completed += 1;
      this._event('stored', batch);
      this._packaging = { phase: 'ready', batch: null, elapsed: 0, duration: 0 };
    }

    if (!this._packagingPaused && this._packaging.phase === 'ready' && this._queue.length) {
      this._packaging = { phase: 'packaging', batch: this._queue.shift(), elapsed: 0, duration: this._packagingDuration() };
      this._event('packaging-started', this._packaging.batch);
    }

    // Queue capacity includes batches travelling toward the shared packer.
    // Iteration order is solely for this isolated illustration.
    for (const line of this._lines) {
      if (line.cache.length && this._queue.length + this._inbound.length < PREVIEW_RULES.packagingQueueCapacity) {
        const batch = line.cache.shift();
        this._inbound.push({ batch, elapsed: 0, duration: PREVIEW_RULES.cacheTransferSeconds });
        this._event('cache-transfer-started', batch);
      }
      if (!line.batch) {
        if (line.cache.length >= PREVIEW_RULES.cacheCapacity) {
          this._setLinePhase(line, 'waitingPackaging');
        } else if (this._supply >= PREVIEW_RULES.batchUnits) {
          this._supply -= PREVIEW_RULES.batchUnits;
          line.batch = this._newBatch(line);
          this._setLinePhase(line, 'feeding');
          this._event('feeding-started', line.batch);
        } else {
          this._setLinePhase(line, 'ready');
        }
      }
    }
  }

  _step(dt) {
    this.time += dt;
    if (this._refillEnabled) {
      this._refillElapsed += dt;
      while (this._refillElapsed >= PREVIEW_RULES.refillEverySeconds) {
        this._refillElapsed -= PREVIEW_RULES.refillEverySeconds;
        this._supply = Math.min(PREVIEW_RULES.supplyCapacity, this._supply + PREVIEW_RULES.refillUnits);
      }
    }
    for (const line of this._lines) {
      if (activePhases.includes(line.phase)) line.elapsed += dt;
    }
    // The scenario blocks new batches; a batch already in packaging or transit
    // keeps moving until its real completion and warehouse arrival.
    if (this._packaging.phase !== 'ready') this._packaging.elapsed += dt;
    const arriving = [];
    this._inbound = this._inbound.filter(transfer => {
      transfer.elapsed += dt;
      if (transfer.elapsed < transfer.duration) return true;
      arriving.push(transfer.batch);
      return false;
    });
    for (const batch of arriving) {
      this._queue.push(batch);
      this._event('packaging-queued', batch);
    }
    this._settle();
  }

  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Preview time must be a finite number of seconds greater than or equal to zero.');
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(PREVIEW_RULES.stepSeconds, remaining);
      this._step(step);
      remaining -= step;
      if (remaining < 1e-9) remaining = 0;
    }
    return this.snapshot();
  }

  _accelerateState(line) {
    if (!line) return { enabled: false, reason: '请选择原味或焦糖加工设备' };
    if (line.phase === 'waitingPackaging') return { enabled: false, reason: '缓存满，等待包装腾出空间' };
    if (!line.batch) return { enabled: false, reason: this._supply < PREVIEW_RULES.batchUnits ? '缺少基础爆米花' : '当前没有进行中的工序' };
    return { enabled: true, reason: '' };
  }

  _supplyAccelerateState() {
    if (!this._refillEnabled) return { enabled: false, reason: '缺料演示已暂停补料' };
    if (this._supply >= PREVIEW_RULES.supplyCapacity) return { enabled: false, reason: '供料储量已满' };
    return { enabled: true, reason: '' };
  }

  _packagingAccelerateState() {
    if (this._packaging.phase === 'productTransfer') return { enabled: false, reason: '成品正在运输入库' };
    if (this._packaging.phase !== 'packaging') return { enabled: false, reason: this._packagingPaused ? '公共包装暂停开始新批次' : '当前没有正在包装的批次' };
    return { enabled: true, reason: '' };
  }

  accelerate(id) {
    if (id === 'supply') {
      const state = this._supplyAccelerateState();
      if (!state.enabled) return { ok: false, reason: state.reason };
      // Advance the actual next refill cycle, completing at most that cycle.
      this._refillElapsed = Math.min(PREVIEW_RULES.refillEverySeconds, this._refillElapsed + PREVIEW_RULES.accelerateSeconds);
      if (this._refillElapsed >= PREVIEW_RULES.refillEverySeconds) {
        this._refillElapsed -= PREVIEW_RULES.refillEverySeconds;
        this._supply = Math.min(PREVIEW_RULES.supplyCapacity, this._supply + PREVIEW_RULES.refillUnits);
        this._event('supply-refilled');
      }
      this._event('supply-accelerated');
      this._settle();
      return { ok: true, reason: '' };
    }
    if (id === 'packer') {
      const state = this._packagingAccelerateState();
      if (!state.enabled) return { ok: false, reason: state.reason };
      this._packaging.elapsed = Math.min(this._packaging.duration, this._packaging.elapsed + PREVIEW_RULES.accelerateSeconds);
      this._event('packaging-accelerated', this._packaging.batch);
      this._settle();
      return { ok: true, reason: '' };
    }
    const line = this._lines.find(entry => entry.id === id);
    const state = this._accelerateState(line);
    if (!state.enabled) return { ok: false, reason: state.reason };
    // Acceleration advances only the current phase, never bypassing buffer gates.
    line.elapsed = Math.min(line.duration, line.elapsed + PREVIEW_RULES.accelerateSeconds);
    this._event('accelerated', line.batch);
    this._settle();
    return { ok: true, reason: '' };
  }

  _lineStatus(line) {
    if (line.phase === 'waitingPackaging' || (!line.batch && line.cache.length >= PREVIEW_RULES.cacheCapacity)) return 'cache-full';
    if (activePhases.includes(line.phase)) return 'processing';
    if (line.cache.length) return 'waiting-pack';
    if (this._supply < PREVIEW_RULES.batchUnits) return 'shortage';
    return 'ready';
  }

  snapshot() {
    const transfers = [];
    for (const line of this._lines) {
      const phase = line.phase === 'waitingPackaging' ? line.heldPhase : line.phase;
      if (line.batch && (phase === 'feeding' || phase === 'discharge')) {
        transfers.push({ id: `${line.batch.id}:${phase}`, kind: phase === 'feeding' ? 'supplyToLine' : 'lineToCache', lineId: line.id, product: line.product, progress: clamp(line.elapsed / line.duration), batchId: line.batch.id });
      }
    }
    for (const transfer of this._inbound) {
      transfers.push({ id: `${transfer.batch.id}:cache-transfer`, kind: 'cacheToPackaging', lineId: transfer.batch.lineId, product: transfer.batch.product, progress: clamp(transfer.elapsed / transfer.duration), batchId: transfer.batch.id });
    }
    if (this._packaging.phase === 'productTransfer') {
      transfers.push({ id: `${this._packaging.batch.id}:warehouse-transfer`, kind: 'packagingToWarehouse', lineId: this._packaging.batch.lineId, product: this._packaging.batch.product, progress: clamp(this._packaging.elapsed / this._packaging.duration), batchId: this._packaging.batch.id });
    }
    return {
      time: this.time,
      scenario: this.scenario,
      rules: PREVIEW_RULES,
      supply: {
        units: this._supply, capacity: PREVIEW_RULES.supplyCapacity,
        refillEnabled: this._refillEnabled,
        nextRefill: this._refillEnabled ? PREVIEW_RULES.refillEverySeconds - this._refillElapsed : null,
        progress: this._refillEnabled && this._supply < PREVIEW_RULES.supplyCapacity ? clamp(this._refillElapsed / PREVIEW_RULES.refillEverySeconds) : 0,
        accelerate: this._supplyAccelerateState(),
      },
      lines: this._lines.map(line => ({
        id: line.id, name: line.name, product: line.product, phase: line.phase, heldPhase: line.heldPhase,
        status: this._lineStatus(line), progress: line.duration ? clamp(line.elapsed / line.duration) : 0,
        batch: publicBatch(line.batch),
        cache: { count: line.cache.length, capacity: PREVIEW_RULES.cacheCapacity, batches: line.cache.map(publicBatch) },
        inventory: line.inventory, completed: line.completed, accelerate: this._accelerateState(line),
      })),
      packaging: {
        phase: this._packaging.phase,
        status: this._packaging.phase !== 'ready' ? 'processing' : this._packagingPaused ? 'cache-full' : this._inbound.length ? 'waiting-pack' : 'ready',
        paused: this._packagingPaused,
        accelerate: this._packagingAccelerateState(),
        progress: this._packaging.duration ? clamp(this._packaging.elapsed / this._packaging.duration) : 0,
        batch: publicBatch(this._packaging.batch),
        queue: this._queue.map(publicBatch), inboundCount: this._inbound.length, occupiedCount: this._queue.length + this._inbound.length,
        queueCapacity: PREVIEW_RULES.packagingQueueCapacity,
      },
      transfers,
      inventory: Object.fromEntries(this._lines.map(line => [line.product, line.inventory])),
      events: this._events.map(event => ({ ...event })),
    };
  }
}

export default FactoryPreviewModel;
