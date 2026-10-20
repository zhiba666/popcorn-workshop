'use strict';

const INSTALL_SECONDS = .9;
const STOCK_SECONDS = 4;
const CLEAR_STABLE_SECONDS = .7;
const CLEAR_SECONDS = 3;
const RECOVERY_LIMIT_SECONDS = 45;
const clamp = value => Math.max(0, Math.min(1, value || 0));
const phaseProgress = batch => batch.duration > 0 ? clamp(batch.elapsed / batch.duration) : 0;
const phaseLabel = {
  'waiting-supply': '首件等待供料', supply: '首件供料中', feeding: '首件进料中',
  processing: '首件加工中', discharging: '首件出机中', transport: '首件转运中',
  'waiting-cache': '缓存满 · 等包装腾位', 'waiting-packaging': '首件等待包装',
  packaging: '首件包装中', warehouse: '首件入库中'
};
const stepForPhase = phase => ({
  'waiting-supply': 1, supply: 1, feeding: 1,
  processing: 2, discharging: 2, transport: 2,
  'waiting-cache': 3, 'waiting-packaging': 3, packaging: 3,
  warehouse: 4, stocked: 4
}[phase] || 1);

// Batch IDs belong to physical batches, whereas firstStockedProducts belongs
// to a product. Always stay on the newly purchased line, including second lines.
function lineBatches(line) {
  const batches = [...(line.buffer || []), ...(line.warehouse || [])];
  if (line.factory.batchId !== null) batches.push({ ...line.factory, id: line.factory.batchId });
  return batches;
}

function findBatch(state, line, id) {
  const factory = line.factory;
  if (factory.batchId === id) return { ...factory, id };
  const cached = (line.buffer || []).find(batch => batch.id === id);
  if (cached) {
    const packer = state.shared.packaging;
    let active = false;
    if (packer.lineId === line.id) {
      const packingBatch = packer.batch;
      active = (packingBatch == null ? undefined : packingBatch.id) === id;
    }
    return { ...cached, phase: active ? 'packaging' : 'waiting-packaging',
      elapsed: active ? packer.elapsed : 0, duration: active ? packer.duration : 0 };
  }
  const transit = (line.warehouse || []).find(batch => batch.id === id);
  return transit ? { ...transit, phase: 'warehouse' } : null;
}

function packagingState(model) {
  const bottleneck = model.productionBottleneck();
  return {
    queuedBatches: bottleneck.queuedBatchCount,
    blockedLineIds: [...bottleneck.blockedLineIds],
    pending: !!model.sharedUpgradeOffer('packaging').pending
  };
}

// These events are presentation only. Production, save data and inventory
// continue to be owned by Model; elapsed time never manufactures completion.
class FactoryPresentation {
  constructor() { this.clear(); }

  clear() {
    this.construction = null;
    this.packaging = null;
  }

  startConstruction(model, lineId, time) {
    const line = model.getLine(lineId);
    if (!line) return;
    const first = lineBatches(line).sort((left, right) => left.id - right.id)[0];
    this.construction = {
      lineId, product: line.product, startedAt: time,
      inventoryBefore: line.inventory, batchId: first && first.id != null ? first.id : null,
      phase: 'waiting-supply', progress: 0, outputLevel: (first == null ? undefined : first.outputLevel) || line.outputLevel,
      completedAt: null
    };
  }

  startPackaging(model, time) {
    const current = packagingState(model);
    const hadBacklog = current.queuedBatches > 0 || current.blockedLineIds.length > 0;
    this.packaging = { startedAt: time, hadBacklog, stableAt: null, clearedAt: null };
  }

  observeProduction(result, time) {
    const event = this.construction;
    if (!event || event.completedAt !== null || result == null || !result.ok) return;
    const producedByLine = result.producedByLine;
    const produced = producedByLine == null ? undefined : producedByLine.find(item => item.lineId === event.lineId && item.units > 0);
    if (!produced) return;
    // A player may take the newly credited goods before the next render.
    // The foreground settlement result still proves that this line stocked.
    event.completedAt = time;
    event.phase = 'stocked'; event.progress = 1; event.outputLevel = produced.level;
  }

  updateConstruction(model, time) {
    const event = this.construction;
    if (!event) return null;
    const line = model.getLine(event.lineId);
    if (!line) { this.construction = null; return null; }
    if (event.completedAt === null) {
      if (line.inventory > event.inventoryBefore) {
        event.completedAt = time;
        event.phase = 'stocked'; event.progress = 1; event.outputLevel = line.outputLevel;
      } else {
        if (event.batchId === null) {
          const first = lineBatches(line).sort((left, right) => left.id - right.id)[0];
          if (first) { event.batchId = first.id; event.outputLevel = first.outputLevel; }
        }
        const batch = event.batchId === null ? null : findBatch(model.state, line, event.batchId);
        if (batch) {
          event.phase = batch.phase; event.progress = phaseProgress(batch);
        }
        // If the observed batch is gone but no stock increase was observed,
        // retain its last stage. Do not substitute a later batch or a timer.
      }
    }
    const completed = event.completedAt !== null;
    const stockProgress = completed ? clamp((time - event.completedAt) / STOCK_SECONDS) : 0;
    if (completed && stockProgress >= 1) { this.construction = null; return null; }
    const installProgress = clamp((time - event.startedAt) / INSTALL_SECONDS);
    return {
      lineId: event.lineId, product: event.product, startedAt: event.startedAt,
      batchId: event.batchId, phase: event.phase,
      step: completed ? 4 : installProgress < 1 ? 0 : stepForPhase(event.phase),
      progress: event.progress, installProgress, completed,
      completedAt: event.completedAt, stockProgress, outputLevel: event.outputLevel,
      text: completed ? '首件已入库 · 可去棋盘取货' : installProgress < 1 ?
        '新机器安装中' : (phaseLabel[event.phase] || '首件生产中') + ' · 入库后可取货'
    };
  }

  updatePackaging(model, time) {
    const event = this.packaging;
    if (!event) return null;
    const current = packagingState(model);
    const clear = current.queuedBatches === 0 && current.blockedLineIds.length === 0 && !current.pending;
    if (event.hadBacklog && event.clearedAt === null) {
      if (!clear) event.stableAt = null;
      else if (event.stableAt === null) event.stableAt = time;
      else if (time - event.stableAt >= CLEAR_STABLE_SECONDS) event.clearedAt = time;
    }
    // A returning queue invalidates the success message immediately.
    if (event.clearedAt !== null && !clear) {
      event.clearedAt = null; event.stableAt = null;
    }
    const cleared = event.clearedAt !== null;
    const expired = cleared ? time - event.clearedAt >= CLEAR_SECONDS :
      time - event.startedAt >= (event.hadBacklog ? RECOVERY_LIMIT_SECONDS : CLEAR_SECONDS);
    if (expired) { this.packaging = null; return null; }
    return { ...current, startedAt: event.startedAt, clearedAt: event.clearedAt,
      recovering: event.hadBacklog && !cleared, cleared, speedOnly: !event.hadBacklog };
  }

  update(model, time) {
    return { construction: this.updateConstruction(model, time), packaging: this.updatePackaging(model, time) };
  }
}

module.exports = { FactoryPresentation };
