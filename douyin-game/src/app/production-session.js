'use strict';

// Production always consumes one wall-clock interval. Rendering and held input
// keep their own frame clock and never advance production a second time.
class ProductionSession {
  constructor({ model, now, writeSave, canWrite = true, isVisible = true,
    onSaveError = () => {}, onSaveSuccess = () => {}, onProductionError = () => {},
    onProductionRecovery = () => {}, onProduced = () => {} }) {
    this.model = model;
    this.now = now;
    this.writeSave = writeSave;
    this.canWrite = canWrite;
    this.visible = isVisible;
    this.ready = false;
    this.lastSaveSucceeded = false;
    this.productionHealthy = true;
    this.pendingSummary = null;
    this.pendingFirstStockedProducts = [];
    this.onSaveError = onSaveError;
    this.onSaveSuccess = onSaveSuccess;
    this.onProductionError = onProductionError;
    this.onProductionRecovery = onProductionRecovery;
    this.onProduced = onProduced;
    this.settle(true);
    this.checkpoint();
  }

  get canInteract() { return this.canWrite && this.ready && this.visible && this.productionHealthy; }

  settle(offline) {
    // A recovery placeholder must neither produce goods nor consume the saved interval.
    if (!this.canWrite) return { ok: false, reason: 'save-recovery-required' };
    const result = offline ? this.model.resumeProduction(this.now()) : this.model.advanceProduction(this.now());
    const wasHealthy = this.productionHealthy;
    this.productionHealthy = Boolean(result && result.ok);
    if (!this.productionHealthy) {
      if (wasHealthy) this.onProductionError(result);
      return result;
    }
    if (!wasHealthy) this.onProductionRecovery();
    if (!offline && result.producedByLine?.length) this.onProduced(result);
    if (offline && result.seconds > 0) {
      this.pendingSummary = mergeOfflineSummary(this.pendingSummary, result);
    } else if (!offline && result.firstStockedProducts?.length) {
      this.pendingFirstStockedProducts = [...new Set([
        ...this.pendingFirstStockedProducts, ...result.firstStockedProducts
      ])];
    }
    return result;
  }

  advance() {
    if (!this.visible) return null;
    return this.settle(false);
  }

  checkpoint() {
    if (!this.canWrite || !this.productionHealthy) {
      this.lastSaveSucceeded = false;
      return false;
    }
    try {
      // The production methods already consumed the interval; serialize with
      // no timestamp so a checkpoint cannot silently consume background time.
      this.writeSave(this.model.serialize());
      this.lastSaveSucceeded = true;
      this.onSaveSuccess();
      return true;
    } catch (error) {
      this.lastSaveSucceeded = false;
      this.onSaveError(error);
      return false;
    }
  }

  setReady() {
    if (this.ready) return;
    if (this.visible) this.advance();
    this.checkpoint();
    this.ready = true;
  }

  hide() {
    if (!this.visible) return;
    this.advance();
    this.visible = false;
    this.checkpoint();
  }

  show() {
    if (this.visible) return;
    this.settle(true);
    this.checkpoint();
    this.visible = true;
  }

  takeOfflineSummary() {
    const summary = this.pendingSummary;
    this.pendingSummary = null;
    return summary ? { ...summary, saveFailed: !this.lastSaveSucceeded } : null;
  }

  takeFirstStockedProducts() {
    const products = this.pendingFirstStockedProducts;
    this.pendingFirstStockedProducts = [];
    return products;
  }
}

function mergeOfflineSummary(previous, next) {
  const produced = new Map();
  for (const item of [...(previous ? previous.producedByLine : []), ...next.producedByLine]) {
    if (!(item.units > 0)) continue;
    const key = item.lineId + '/' + item.product + '/' + item.level;
    const value = produced.get(key);
    if (value) value.units += item.units;
    else produced.set(key, { lineId: item.lineId, product: item.product, level: item.level, units: item.units });
  }
  return {
    seconds: (previous ? previous.seconds : 0) + next.seconds,
    capped: Boolean((previous && previous.capped) || next.capped),
    producedByLine: [...produced.values()],
    firstStockedProducts: [...new Set([
      ...(previous?.firstStockedProducts || []), ...(next.firstStockedProducts || [])
    ])],
    saveFailed: Boolean((previous && previous.saveFailed) || next.saveFailed),
  };
}

module.exports = { ProductionSession, mergeOfflineSummary };
