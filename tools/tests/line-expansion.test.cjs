'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameModel } = require('../../douyin-game/src/model');
const { PRODUCTION_CONFIG } = require('../../douyin-game/src/production-config');
const { ProductionSession } = require('../../douyin-game/src/production-session');

const clone = value => JSON.parse(JSON.stringify(value));
const unitValue = level => 2 ** (level - 1);

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

function purchase(model, product) {
  const offer = model.lineExpansionOffer(product);
  assert.ok(offer && !offer.maxed);
  model.state.coins += offer.cost;
  const result = model.buyLine(product);
  assert.equal(result.ok, true);
  return result;
}

function failedPurchase(model, product, reason) {
  const before = model.serialize();
  const result = model.buyLine(product);
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
  assert.deepEqual(model.serialize(), before, 'a failed purchase cannot consume coins, goods, IDs or production progress');
}

function allLinesModel() {
  const model = new GameModel();
  purchase(model, 'original');
  purchase(model, 'caramel');
  return model;
}

function protectedState(model) {
  const { board, coins, completedOrders, order } = model.state;
  return clone({ board, coins, completedOrders, order });
}

test('buying a second line charges its offer and adds one independent level-one line and launcher', () => {
  const model = new GameModel();
  model.update(12);
  assert.equal(model.launch('original-1').ok, true);
  const offer = model.lineExpansionOffer('original');
  assert.equal(model.lineExpansionOffer('original-1').product, offer.product);
  model.state.coins = offer.cost + 17;
  const before = model.serialize();
  const result = model.buyLine('original');
  assert.equal(result.ok, true);
  assert.equal(result.cost, offer.cost);
  assert.equal(model.state.coins, before.coins - offer.cost);
  assert.equal(model.state.lines.length, before.lines.length + 1);
  for (const oldLine of before.lines) assert.deepEqual(model.getLine(oldLine.id), oldLine);
  for (let index = 0; index < before.board.length; index += 1) {
    if (before.board[index]) assert.deepEqual(model.state.board[index], before.board[index]);
  }
  const added = model.getLine(result.lineId);
  assert.equal(added.product, 'original');
  assert.equal(added.outputLevel, 1);
  assert.equal(added.capacityLevel, 1);
  assert.equal(added.inventory, 0);
  assert.equal(added.factory.phase, 'waiting-supply');
  assert.deepEqual(added.buffer, []);
  assert.deepEqual(added.warehouse, []);
  assert.equal(added.legacyGroup, null);
  const launchers = model.state.board.filter(item => item?.kind === 'launcher' && item.lineId === added.id);
  assert.equal(launchers.length, 1);
  assert.equal(launchers[0].level, 1);
  assert.equal(model.state.selectedLineId, added.id);
  assert.deepEqual(model.state.order, before.order);
  assert.deepEqual(model.state.shared.supply.queue, [...before.shared.supply.queue, added.id]);
  assert.deepEqual(model.state.shared.packaging, before.shared.packaging);
});

test('insufficient money, full board, existing second line and invalid products fail atomically', () => {
  const poor = new GameModel();
  failedPurchase(poor, 'original', 'insufficient-coins');
  failedPurchase(poor, 'unknown-product', 'invalid-product');

  const full = new GameModel();
  full.state.coins = full.lineExpansionOffer('original').cost;
  for (let index = 0; index < full.state.board.length; index += 1) {
    if (!full.state.board[index]) full.state.board[index] = {
      kind: 'product', product: 'original', level: 1, id: full.state.nextItemId++
    };
  }
  assert.equal(full.lineExpansionOffer('original').hasSpace, false);
  failedPurchase(full, 'original', 'board-full');

  const expanded = new GameModel();
  const result = purchase(expanded, 'original');
  expanded.state.coins = result.cost;
  assert.equal(expanded.lineExpansionOffer('original').maxed, true);
  failedPurchase(expanded, 'original', 'line-max');
});

test('launch uses only the selected line stock and equal goods can merge across lines without loss', () => {
  const model = new GameModel();
  const result = purchase(model, 'original');
  const first = model.getLine('original-1');
  const second = model.getLine(result.lineId);
  first.inventory = 3;
  second.inventory = 2;
  const goodsValue = () => first.inventory * unitValue(first.outputLevel) +
    second.inventory * unitValue(second.outputLevel) + model.state.board.reduce((sum, item) =>
      sum + (item?.kind === 'product' ? unitValue(item.level) : 0), 0);
  const before = goodsValue();
  model.selectLine(second.id);
  const secondShot = model.launch();
  assert.equal(secondShot.ok, true);
  assert.equal(first.inventory, 3);
  assert.equal(second.inventory, 1);
  const firstShot = model.launch(first.id);
  assert.equal(firstShot.ok, true);
  assert.equal(first.inventory, 2);
  assert.equal(second.inventory, 1);
  const merged = model.drop(secondShot.to, firstShot.to);
  assert.equal(merged.ok, true);
  assert.equal(merged.action, 'merge');
  assert.equal(model.state.board[merged.to].product, 'original');
  assert.equal(model.state.board[merged.to].level, 2);
  assert.equal(goodsValue(), before);
  for (const line of [first, second]) {
    assert.equal(model.state.board.filter(item => item?.kind === 'launcher' && item.lineId === line.id).length, 1);
  }
});

test('output upgrades isolate inventory and old batches and use the lowest same-product line for old orders', () => {
  const model = new GameModel();
  const newLine = purchase(model, 'original');
  const first = model.getLine('original-1');
  const second = model.getLine(newLine.lineId);
  first.inventory = 10;
  second.inventory = 7;
  assert.equal(model.launch(first.id).ok, true);
  model.state.order.requirements = [{ product: 'original', level: 1 }];
  model.state.coins = model.outputOffer(first.id).cost;
  const otherLine = clone(second);
  const boardGoods = clone(model.state.board.filter(item => item?.kind === 'product'));
  const beforeOrder = clone(model.state.order);
  const oldBatchId = first.factory.batchId;
  assert.equal(model.upgradeOutput(first.id).ok, true);
  assert.equal(first.inventory, 4);
  assert.equal(first.discardedBaseUnits, 1);
  assert.deepEqual(first.legacyGroup.batchIds, [oldBatchId]);
  assert.deepEqual(second, otherLine);
  assert.deepEqual(model.state.board.filter(item => item?.kind === 'product'), boardGoods);
  assert.deepEqual(model.state.order, beforeOrder, 'one high line cannot raise a target supported by a low line');

  const single = new GameModel();
  single.state.order.requirements = [{ product: 'original', level: 1 }];
  single.state.coins = single.outputOffer('original-1').cost;
  assert.equal(single.upgradeOutput('original-1').ok, true);
  assert.equal(single.state.order.requirements[0].level, 2);
  const raisedOrder = clone(single.state.order);
  purchase(single, 'original');
  assert.deepEqual(single.state.order, raisedOrder, 'buying a new low line neither lowers nor redraws an existing order');
});

test('dynamic lines persist, old two-line saves add no free lines and damaged ownership stays protected', () => {
  const originalSave = new GameModel().serialize();
  const originalRestore = new GameModel(originalSave);
  assert.equal(originalRestore.recoveryRequired, false);
  assert.equal(originalRestore.state.lines.length, originalSave.lines.length);
  assert.deepEqual(originalRestore.state.lines.map(line => line.id), originalSave.lines.map(line => line.id));

  const expanded = allLinesModel();
  expanded.update(11);
  const saved = expanded.serialize();
  const restored = new GameModel(saved);
  assert.equal(restored.recoveryRequired, false);
  assertEquivalent(restored.serialize(), saved);
  for (const line of restored.state.lines) {
    assert.equal(restored.state.board.filter(item => item?.kind === 'launcher' && item.lineId === line.id).length, 1);
  }

  const assertProtected = invalid => {
    const oldBytes = JSON.stringify(invalid);
    const model = new GameModel(invalid);
    assert.equal(model.recoveryRequired, true);
    let writes = 0;
    const session = new ProductionSession({ model, now: () => 1000, canWrite: !model.recoveryRequired,
      writeSave: () => { writes += 1; } });
    session.setReady(); session.checkpoint();
    assert.equal(writes, 0);
    assert.equal(JSON.stringify(invalid), oldBytes);
  };
  const invalidId = clone(saved);
  invalidId.lines.find(line => line.id === 'original-2').id = 'unknown-line';
  assertProtected(invalidId);
  const missingLauncher = clone(saved);
  const launcherIndex = missingLauncher.board.findIndex(item => item?.kind === 'launcher' && item.lineId === 'original-2');
  missingLauncher.board[launcherIndex] = null;
  assertProtected(missingLauncher);
});

test('four lines share online and offline production consistently with a two-hour cap and no duplicate resume', () => {
  const seed = allLinesModel().serialize();
  const continuous = new GameModel(seed);
  const stepped = new GameModel(seed);
  continuous.update(120);
  for (let step = 0; step < 600; step += 1) stepped.update(0.2);
  assertEquivalent(stepped.serialize(), continuous.serialize());
  for (const line of continuous.state.lines) assert.ok(line.inventory > 0, 'every real line can receive shared supply and packaging');

  const offline = new GameModel(seed);
  offline.resumeProduction(1000);
  const protectedBefore = protectedState(offline);
  const reference = new GameModel(offline.serialize());
  reference.advanceProduction(1000 + PRODUCTION_CONFIG.offlineLimitSeconds * 1000);
  const result = offline.resumeProduction(1000 + 24 * 60 * 60 * 1000);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, PRODUCTION_CONFIG.offlineLimitSeconds);
  assert.equal(result.capped, true);
  assert.deepEqual(protectedState(offline), protectedBefore);
  for (const line of offline.state.lines) assert.ok(line.inventory > 0);
  const actual = offline.serialize(); const expected = reference.serialize();
  delete actual.productionAt; delete expected.productionAt;
  assertEquivalent(actual, expected);
  const settled = offline.serialize();
  assert.equal(offline.resumeProduction(settled.productionAt).seconds, 0);
  assertEquivalent(offline.serialize(), settled);
});
