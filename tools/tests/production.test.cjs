'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameModel } = require('../../douyin-game/src/model');
const { PRODUCTION_CONFIG } = require('../../douyin-game/src/production-config');
const { ProductionSession } = require('../../douyin-game/src/production-session');

const clone = value => JSON.parse(JSON.stringify(value));
const unitValue = level => 2 ** (level - 1);
const initialState = new GameModel().state;
const INITIAL_MATERIAL_UNITS = initialState.shared.materials.baseUnits + initialState.lines.reduce((sum, line) =>
  sum + (line.factory.batchId === null ? 0 : line.factory.baseUnits), 0);

function assertEquivalent(actual, expected, path = 'state') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) < 1e-6, `${path}: ${actual} != ${expected}`);
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys`);
    for (const key of Object.keys(actual)) assertEquivalent(actual[key], expected[key], `${path}.${key}`);
    return;
  }
  assert.equal(actual, expected, path);
}

function productionBalance(model) {
  const state = model.state;
  let held = state.shared.materials.baseUnits;
  for (const item of state.board) if (item && item.kind === 'product') held += unitValue(item.level);
  for (const line of state.lines) {
    held += line.inventory * unitValue(line.outputLevel) + line.discardedBaseUnits;
    if (line.factory.batchId !== null) held += line.factory.baseUnits;
    held += line.buffer.reduce((sum, batch) => sum + batch.baseUnits, 0);
    held += line.warehouse.reduce((sum, batch) => sum + (batch.credited ? 0 : batch.baseUnits), 0);
    if (line.legacyGroup) held += line.legacyGroup.completedBaseUnits;
  }
  return { held, supplied: INITIAL_MATERIAL_UNITS + state.shared.materials.refilledBaseUnits };
}

function assertConserved(model) {
  const balance = productionBalance(model);
  assert.equal(balance.held, balance.supplied, 'real goods, pending goods, materials and declared loss conserve inputs');
}

function protectedState(model) {
  const { board, order, coins, completedOrders } = model.state;
  return clone({ board, order, coins, completedOrders });
}

function assertWithinCacheCapacity(model) {
  for (const line of model.state.lines) {
    assert.ok(line.buffer.reduce((sum, batch) => sum + batch.baseUnits, 0) <= PRODUCTION_CONFIG.cacheCapacityBaseUnits);
  }
  const packaging = model.state.shared.packaging.batch;
  if (packaging) {
    const owners = model.state.lines.flatMap(line => line.buffer.filter(batch => batch.id === packaging.id));
    assert.equal(owners.length, 1, 'shared packaging owns exactly one real cached batch');
  }
}

// Persisted backlogs are valid inputs even when the current starting machines
// normally leave the shared packer with spare capacity.
function backloggedModel(inventory = 0) {
  const model = new GameModel();
  for (let step = 0; step < 1000 && model.state.shared.packaging.batch?.lineId !== 'original-1'; step += 1) {
    model.update(0.01);
  }
  const saved = model.serialize();
  const line = saved.lines.find(candidate => candidate.id === 'original-1');
  line.inventory += inventory;
  saved.shared.materials.refilledBaseUnits += inventory * unitValue(line.outputLevel);
  const packaging = saved.shared.packaging.batch;
  assert.equal(packaging.lineId, line.id);
  const template = line.buffer.find(batch => batch.id === packaging.id);
  const extra = { ...clone(template), id: saved.nextBatchId++, status: 'waiting' };
  line.buffer.push(extra);
  saved.shared.materials.refilledBaseUnits += extra.baseUnits;
  if (!saved.shared.packaging.queue.includes(line.id)) saved.shared.packaging.queue.push(line.id);
  if (line.factory.batchId === null) {
    line.factory.batchId = saved.nextBatchId++;
    saved.shared.materials.refilledBaseUnits += line.factory.baseUnits;
  }
  line.factory.phase = 'waiting-cache';
  line.factory.elapsed = 0;
  line.factory.duration = 0;
  saved.shared.supply.queue = saved.shared.supply.queue.filter(id => id !== line.id);
  if (saved.shared.supply.lineId === line.id) {
    saved.shared.supply.lineId = null;
    saved.shared.supply.elapsed = 0;
  }
  const restored = new GameModel(saved);
  assert.equal(restored.recoveryRequired, false, 'backlog fixture must pass normal save validation');
  assertConserved(restored);
  return restored;
}

function v4Save() {
  const board = Array(63).fill(null);
  board[8] = { kind: 'launcher', lineId: 'original-1', product: 'original', level: 1, id: 1 };
  board[12] = { kind: 'launcher', lineId: 'caramel-1', product: 'caramel', level: 1, id: 2 };
  const factory = phase => ({ phase, elapsed: 0, duration: phase === 'processing' ? 2 : 0,
    capacityLevel: 1, outputLevel: 1, batchUnits: 4 });
  return {
    schemaVersion: 4, coins: 17, completedOrders: 0, page: 'board', selectedCell: 8,
    selectedLineId: 'original-1', board, nextItemId: 3,
    lines: [
      { id: 'original-1', product: 'original', inventory: 9, capacityLevel: 1, outputLevel: 1,
        discardedBaseUnits: 0, factory: factory('processing') },
      { id: 'caramel-1', product: 'caramel', inventory: 7, capacityLevel: 1, outputLevel: 1,
        discardedBaseUnits: 0, factory: factory('waiting-supply') },
    ],
    shared: {
      materials: { baseUnits: 4, capacityBaseUnits: 8, elapsed: 0, duration: 2.2, refillBaseUnits: 4 },
      supply: { lineId: null, elapsed: 0, duration: 0.6, queue: ['caramel-1'] },
      packaging: { lineId: null, elapsed: 0, duration: 0.95, queue: [] },
    },
    order: { id: 1, requirements: [{ product: 'original', level: 3 }], reward: 60 },
  };
}

function legacySave(version) {
  const saved = v4Save();
  saved.schemaVersion = version;
  saved.board[12] = null;
  saved.nextItemId = 2;
  saved.line = { ...saved.lines[0] };
  saved.factory = saved.line.factory;
  delete saved.line.factory;
  saved.order = { id: 1, product: 'original', level: 5, reward: 180 };
  delete saved.lines;
  delete saved.shared;
  delete saved.selectedLineId;
  if (version === 1) { delete saved.line.capacityLevel; delete saved.factory.capacityLevel; }
  if (version < 3) { delete saved.line.discardedBaseUnits; delete saved.factory.outputLevel; }
  return saved;
}

test('online production is identical with short steps and a long interval', () => {
  const continuous = new GameModel();
  const stepped = new GameModel();
  continuous.update(120);
  for (let step = 0; step < 600; step += 1) { stepped.update(0.2); assertWithinCacheCapacity(stepped); }
  assertEquivalent(stepped.serialize(), continuous.serialize());
  for (const line of continuous.state.lines) assert.ok(line.inventory > 0, 'both lines receive shared capacity');
});

test('production, launch and output upgrades conserve real material', () => {
  const model = new GameModel();
  model.update(40);
  assertConserved(model);
  assert.equal(model.launch('original-1').ok, true);
  assertConserved(model);
  model.state.coins = 1000;
  assert.equal(model.upgradeOutput('original-1').ok, true);
  assertConserved(model);
  for (let step = 0; step < 100; step += 1) { model.update(0.2); assertConserved(model); }
});

test('a full line cache waits safely while another line can progress, then recovers', () => {
  const model = backloggedModel();
  const original = model.getLine('original-1');
  const caramelBefore = clone(model.getLine('caramel-1').factory);
  assert.equal(original.factory.phase, 'waiting-cache');
  model.update(0.05);
  assert.equal(original.factory.phase, 'waiting-cache');
  assert.notDeepEqual(model.getLine('caramel-1').factory, caramelBefore);
  assertWithinCacheCapacity(model);
  assertConserved(model);
  const inventory = original.inventory;
  model.update(30);
  assert.ok(original.inventory > inventory);
  assertWithinCacheCapacity(model);
  assertConserved(model);
});

test('an upgraded line aggregates old batches once and preserves other lines and board goods', () => {
  const model = backloggedModel(10);
  assert.equal(model.launch('original-1').ok, true);
  model.state.coins = 1000;
  const original = model.getLine('original-1');
  const otherLine = clone(model.getLine('caramel-1'));
  const boardGoods = clone(model.state.board.filter(item => item?.kind === 'product'));
  const inventoryBefore = original.inventory;
  assert.equal(model.upgradeOutput(original.id).ok, true);
  assert.deepEqual(model.getLine('caramel-1'), otherLine);
  assert.deepEqual(model.state.board.filter(item => item?.kind === 'product'), boardGoods);
  const groupUnits = original.factory.baseUnits + original.buffer.reduce((sum, batch) => sum + batch.baseUnits, 0);
  assert.ok(original.legacyGroup.batchIds.length > 1, 'multiple old batches form one settlement group');
  const restored = new GameModel(model.serialize());
  assert.equal(restored.recoveryRequired, false);
  for (let step = 0; step < 1000 && original.legacyGroup; step += 1) {
    model.update(0.01); restored.update(0.01); assertConserved(model);
    if (original.legacyGroup) assert.equal(original.inventory, Math.floor(inventoryBefore / 2));
  }
  assert.equal(original.legacyGroup, null);
  assert.equal(original.inventory, Math.floor(inventoryBefore / 2) + Math.floor(groupUnits / 2));
  assertEquivalent(restored.serialize(), model.serialize());
  const settled = new GameModel(model.serialize());
  settled.update(0);
  assert.equal(settled.getLine(original.id).inventory, original.inventory, 'reloading cannot credit the group again');
});

test('current saves round trip and v4 saves migrate without changing player goods or rewards', () => {
  const current = new GameModel();
  current.update(9);
  const snapshot = current.serialize();
  const restored = new GameModel(snapshot);
  assert.equal(restored.restored, true);
  assertEquivalent(restored.serialize(), snapshot);
  const old = v4Save();
  const migrated = new GameModel(old);
  assert.equal(migrated.restored, true);
  assert.equal(migrated.recoveryRequired, false);
  assert.ok(migrated.state.schemaVersion > old.schemaVersion);
  assert.deepEqual(protectedState(migrated), { board: old.board, order: old.order, coins: old.coins, completedOrders: 0 });
  assert.deepEqual(migrated.state.lines.map(line => line.inventory), old.lines.map(line => line.inventory));
  const stable = new GameModel(migrated.serialize());
  assertEquivalent(stable.serialize(), migrated.serialize());
});

test('v1, v2 and v3 saves retain original goods and add only the second launcher', () => {
  for (const version of [1, 2, 3]) {
    const saved = legacySave(version);
    const migrated = new GameModel(saved);
    assert.equal(migrated.restored, true, `v${version}`);
    assert.equal(migrated.getLine('original-1').inventory, saved.line.inventory);
    assert.equal(migrated.getLine('caramel-1').inventory, 0);
    assert.equal(migrated.state.coins, saved.coins);
    assert.deepEqual(migrated.state.order, { id: 1, requirements: [{ product: 'original', level: 5 }], reward: 180 });
    assert.equal(migrated.state.board.filter(item => item?.kind === 'launcher').length, 2);
    assert.equal(new GameModel(migrated.serialize()).recoveryRequired, false);
  }
});

test('damaged saves remain protected from every automatic session checkpoint', () => {
  const assertProtected = (saved, description) => {
    const originalBytes = JSON.stringify(saved);
    const model = new GameModel(saved);
    assert.equal(model.recoveryRequired, true, description);
    let now = 1000;
    const writes = [];
    const session = new ProductionSession({ model, now: () => now, canWrite: !model.recoveryRequired,
      writeSave: snapshot => writes.push(snapshot) });
    session.setReady(); now += 5000; session.hide(); now += 10000; session.show(); session.checkpoint();
    assert.equal(writes.length, 0, description);
    assert.equal(JSON.stringify(saved), originalBytes, 'recovery leaves the old save intact');
  };

  const invalid = v4Save();
  invalid.lines[0].inventory = -1;
  assertProtected(invalid, 'negative stored goods');

  const nullRequirement = new GameModel().serialize();
  nullRequirement.order.requirements = [null];
  assertProtected(nullRequirement, 'null order entries are rejected without throwing');

  const pending = backloggedModel(10);
  pending.state.coins = 1000;
  pending.upgradeOutput('original-1');
  for (let step = 0; step < 1000 && !pending.getLine('original-1').legacyGroup?.completedBatches.length; step += 1) {
    pending.update(0.01);
  }
  const partial = pending.serialize();
  const partialLine = partial.lines.find(line => line.id === 'original-1');
  assert.ok(partialLine.legacyGroup.batchIds.length > 0);
  assert.ok(partialLine.warehouse.some(batch => batch.credited));
  assert.equal(new GameModel(partial).recoveryRequired, false,
    'a completed record and its same-line credited transport are a valid shared reference');

  const missingCompleted = clone(partial);
  const missingLine = missingCompleted.lines.find(line => line.id === 'original-1');
  missingLine.legacyGroup.completedBatches = [];
  missingLine.legacyGroup.completedBaseUnits = 0;
  assertProtected(missingCompleted, 'credited goods cannot disappear from an unfinished settlement group');

  const secondUpgrade = new GameModel(partial);
  assert.equal(secondUpgrade.upgradeOutput('caramel-1').ok, true);
  const distinctCompleted = secondUpgrade.serialize();
  const originalLine = distinctCompleted.lines.find(line => line.id === 'original-1');
  const caramelLine = distinctCompleted.lines.find(line => line.id === 'caramel-1');
  originalLine.warehouse = [];
  const finishedBatch = { ...clone(originalLine.legacyGroup.completedBatches[0]),
    id: distinctCompleted.nextBatchId++, lineId: caramelLine.id, product: caramelLine.product };
  caramelLine.legacyGroup.completedBatches.push(finishedBatch);
  caramelLine.legacyGroup.completedBaseUnits += finishedBatch.baseUnits;
  distinctCompleted.shared.materials.refilledBaseUnits += finishedBatch.baseUnits;
  assert.equal(new GameModel(distinctCompleted).recoveryRequired, false,
    'the same scenario with distinct completed batch IDs remains valid');
  const duplicateCompleted = clone(distinctCompleted);
  duplicateCompleted.lines.find(line => line.id === 'caramel-1').legacyGroup.completedBatches[0].id =
    originalLine.legacyGroup.completedBatches[0].id;
  assertProtected(duplicateCompleted, 'completed batch IDs cannot belong to two different lines');

  const safeMigration = v4Save();
  safeMigration.lines[0].outputLevel = 2;
  safeMigration.lines[0].inventory = 1;
  safeMigration.board[8].level = 2;
  safeMigration.lines[0].factory.phase = 'warehouse';
  safeMigration.lines[0].factory.duration = 0.7;
  assert.equal(new GameModel(safeMigration).recoveryRequired, false,
    'a packaged old batch can migrate when its settlement fits the inventory');
  const overflowingMigration = clone(safeMigration);
  overflowingMigration.lines[0].inventory = Number.MAX_SAFE_INTEGER - 1;
  assertProtected(overflowingMigration, 'old-batch migration must reject an unsafe inventory settlement');
});

test('offline production is capped at two hours and changes supply inventory only', () => {
  const model = new GameModel();
  model.resumeProduction(1000);
  model.state.coins = 83;
  const before = protectedState(model);
  const reference = new GameModel(model.serialize());
  reference.advanceProduction(1000 + PRODUCTION_CONFIG.offlineLimitSeconds * 1000);
  const result = model.resumeProduction(1000 + 24 * 60 * 60 * 1000);
  assert.equal(result.ok, true);
  assert.equal(result.capped, true);
  assert.equal(result.seconds, PRODUCTION_CONFIG.offlineLimitSeconds);
  assert.deepEqual(protectedState(model), before);
  for (const line of model.state.lines) assert.ok(line.inventory > 0);
  const actual = model.serialize(); const expected = reference.serialize();
  delete actual.productionAt; delete expected.productionAt;
  assertEquivalent(actual, expected);
  assertConserved(model);
});

test('repeated resume and clock rollback never duplicate production', () => {
  const model = new GameModel();
  model.resumeProduction(100000);
  model.resumeProduction(160000);
  const settled = model.serialize();
  for (const time of [160000, 150000, 100000, 160000]) {
    assert.equal(model.resumeProduction(time).seconds, 0);
    assertEquivalent(model.serialize(), settled);
  }
  const reference = new GameModel(settled);
  reference.update(5);
  model.advanceProduction(165000);
  const actual = model.serialize(); const expected = reference.serialize();
  delete actual.productionAt; delete expected.productionAt;
  assertEquivalent(actual, expected);
});

test('repeated lifecycle events consume intervals once and checkpoint is a pure snapshot', () => {
  let now = 1000;
  const model = new GameModel();
  const writes = [];
  const session = new ProductionSession({ model, now: () => now, writeSave: snapshot => writes.push(clone(snapshot)) });
  session.setReady();
  now += 5000; session.hide();
  const hidden = model.serialize();
  now += 10000; session.hide(); session.advance(); session.checkpoint();
  assertEquivalent(model.serialize(), hidden);
  session.show();
  const shown = model.serialize();
  now += 10000; session.show(); session.checkpoint();
  assertEquivalent(model.serialize(), shown);
  session.advance();
  const reference = new GameModel(); reference.resumeProduction(1000); reference.advanceProduction(now);
  assertEquivalent(model.serialize(), reference.serialize());
  assert.deepEqual(writes.at(-1), shown, 'checkpoint does not consume a new clock interval');
});

test('background time during resource loading is settled once and its summary is consumed once', () => {
  let now = 1000;
  const model = new GameModel();
  const session = new ProductionSession({ model, now: () => now, writeSave: () => {} });
  assert.equal(session.canInteract, false);
  now += 5000; session.hide(); now += 60000; session.show();
  assert.equal(session.canInteract, false);
  now += 10000; session.hide(); now += 120000; session.setReady();
  assert.equal(session.canInteract, false);
  session.show(); assert.equal(session.canInteract, true);
  now += 3000; session.advance();
  const reference = new GameModel(); reference.resumeProduction(1000); reference.advanceProduction(now);
  assertEquivalent(model.serialize(), reference.serialize());
  const summary = session.takeOfflineSummary();
  assert.equal(summary.seconds, 180);
  assert.equal(summary.capped, false);
  assert.ok(summary.producedByLine.some(item => item.units > 0));
  assert.equal(session.takeOfflineSummary(), null);
});
