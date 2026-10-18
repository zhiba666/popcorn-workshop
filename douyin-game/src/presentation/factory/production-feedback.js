'use strict';

const { PRODUCTION_CONFIG: CONFIG } = require('../../domain/production/production-config');

const PHASE_LABELS = { 'waiting-supply': '等待供料', 'waiting-cache': '待缓存', supply: '供料准备',
  feeding: '输送进料', processing: '加工中', discharging: '出机转运', transport: '出机转运',
  'waiting-packaging': '待包装', packaging: '包装中', warehouse: '入库中' };
const phaseProgress = batch => batch.duration > 0 ?
  Math.max(0, Math.min(1, batch.elapsed / batch.duration)) : 0;
const feedbackProgress = batch => {
  const p = phaseProgress(batch), { discharging, transport } = CONFIG.phaseDurations;
  if (batch.phase === 'discharging') return p * discharging / (discharging + transport);
  if (batch.phase === 'transport') return (discharging + p * transport) / (discharging + transport);
  return p;
};
const isCacheBlocked = line => line.factory.phase === 'waiting-cache' || line.factory.phase === 'waiting-supply' &&
  (line.buffer || []).reduce((sum, batch) => sum + batch.baseUnits, 0) + line.factory.baseUnits > line.cacheCapacityBaseUnits;
const arrivalStage = phase => ({ warehouse: 0, packaging: 1, 'waiting-packaging': 2 }[phase] ?? 3);
function nearerToStock(left, right) {
  const stage = arrivalStage(left.phase) - arrivalStage(right.phase);
  if (stage) return stage < 0 ? left : right;
  if (left.phase === 'warehouse') {
    const remaining = (left.duration - left.elapsed) - (right.duration - right.elapsed);
    if (remaining) return remaining < 0 ? left : right;
  }
  return left.id < right.id ? left : right;
}

// Follow physical batches after the machine starts its next cycle. Nothing in
// this view changes production, inventory or the saved first-stocked marker.
function lineProductionFeedback(state, line) {
  const factory = line.factory, buffer = line.buffer || [];
  const packaging = state.shared.packaging;
  const cacheBlocked = isCacheBlocked(line);
  const machinePhase = cacheBlocked ? 'waiting-cache' : factory.phase;
  const firstBatch = !(state.firstStockedProducts || []).includes(line.product);
  let tracked = { ...factory, id: factory.batchId, lineId: line.id, phase: machinePhase, cacheBlocked };

  if (firstBatch) {
    const pending = [];
    state.lines.filter(candidate => candidate.product === line.product).forEach(candidate => {
      const blocked = isCacheBlocked(candidate), current = candidate.factory;
      (candidate.buffer || []).forEach(batch => {
        const active = packaging.lineId === candidate.id && packaging.batch?.id === batch.id;
        pending.push({ id: batch.id, lineId: candidate.id, cacheBlocked: blocked,
          phase: active ? 'packaging' : 'waiting-packaging', elapsed: active ? packaging.elapsed : 0,
          duration: active ? packaging.duration : 0 });
      });
      pending.push(...(candidate.warehouse || []).filter(batch => !batch.credited)
        .map(batch => ({ ...batch, phase: 'warehouse' })));
      if (current.batchId !== null) pending.push({ ...current, id: current.batchId, lineId: candidate.id,
        cacheBlocked: blocked, phase: blocked ? 'waiting-cache' : current.phase });
    });
    if (pending.length) tracked = pending.reduce(nearerToStock);
  }

  const label = PHASE_LABELS[tracked.phase] || '生产中';
  let text;
  if (firstBatch) {
    const next = tracked.phase === 'warehouse' ? '即将可取货' : tracked.phase === 'waiting-cache' ?
      '等包装腾位' : tracked.phase === 'waiting-packaging' ?
        (tracked.cacheBlocked ? '缓存满待腾位' : '公共包装排队') : '入库后可取货';
    text = '首件' + label + ' · ' + next;
  } else {
    text = cacheBlocked ? '缓存满 · 等包装腾位 · ' + buffer.length + '批' :
      label + ' · Lv.' + line.outputLevel + ' · 缓存 ' + buffer.length + '批';
  }
  return { firstBatch, phase: tracked.phase, batchId: tracked.id, lineId: tracked.lineId, cacheBlocked,
    text, progress: feedbackProgress(tracked) };
}

module.exports = { lineProductionFeedback };
