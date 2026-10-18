'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { GameModel } = require('../douyin-game/src/domain/game-model');
const { ProductionSession } = require('../douyin-game/src/app/production-session');
const { SaveRecovery } = require('../douyin-game/src/persistence/save-recovery');

const SAVE_KEY = 'popcorn-dual-product-v4';
const LEGACY_SAVE_KEY = 'popcorn-original-single-line-v1';
const BACKUP_KEY = SAVE_KEY + '-recovery-backup-v1';
const clone = value => JSON.parse(JSON.stringify(value));

// Exercise the actual platform adapters without changing global browser/tt state.
function storedPlatform(kind, entries) {
  const records = new Map(entries);
  const writes = [];
  const faults = { read: false, backup: false, save: false };
  const read = key => {
    if (faults.read) throw new Error('storage temporarily unavailable');
    const value = records.get(key);
    return value === undefined ? null : clone(value);
  };
  const write = (key, value) => {
    if ((key.startsWith(BACKUP_KEY) && faults.backup) || (key === SAVE_KEY && faults.save)) {
      throw new Error('storage is full');
    }
    records.set(key, clone(value));
    writes.push({ key, value: clone(value) });
  };
  const context = {
    module: { exports: {} },
    require: specifier => {
      assert.ok(['../domain/production/production-config', '../presentation/factory/production-feedback'].includes(specifier));
      return require(path.resolve(__dirname, '../douyin-game/src/platform', specifier));
    },
    console: { error() {} },
  };
  if (kind === 'browser') {
    context.document = { hidden: false, getElementById: () => ({}) };
    context.window = { devicePixelRatio: 1, localStorage: {
      getItem: read,
      setItem: (key, value) => write(key, String(value)),
    } };
  } else {
    context.tt = {
      createCanvas: () => ({}),
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }),
      getStorageInfoSync: () => {
        if (faults.read) throw new Error('storage temporarily unavailable');
        return { keys: [...records.keys()] };
      },
      getStorageSync: read,
      setStorageSync: write,
    };
  }
  const filename = path.resolve(__dirname, '../douyin-game/src/platform/platform.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const platform = context.module.exports.createPlatform();
  platform.now = () => 100000;
  return { platform, records, writes, faults,
    encode: value => kind === 'browser' ? JSON.stringify(value) : clone(value),
    decode: value => kind === 'browser' ? JSON.parse(value) : clone(value) };
}

test('retry restores the original save after a read failure without advancing or overwriting the recovery model', () => {
  for (const kind of ['browser', 'douyin']) {
    const stored = storedPlatform(kind, [[SAVE_KEY, '{ damaged save']]);
    stored.faults.read = true;
    const recovery = new SaveRecovery(stored.platform);
    assert.equal(recovery.issue.reason, 'read-failed', kind);
    const blockedModel = recovery.model;
    const blockedState = clone(blockedModel.serialize());
    const blockedSession = new ProductionSession({ model: blockedModel, now: () => 100000,
      canWrite: false, writeSave: value => stored.platform.writeSave(value) });
    blockedSession.setReady(); blockedSession.advance(); blockedSession.hide(); blockedSession.show();
    assert.equal(blockedSession.canInteract, false, 'recovery must not allow unsavable play');
    assert.equal(blockedSession.checkpoint(), false);
    assert.deepEqual(blockedModel.serialize(), blockedState, 'recovery must not produce temporary goods');

    stored.faults.read = false;
    assert.equal(recovery.retry().ok, false);
    assert.equal(recovery.issue.reason, 'invalid-save', kind);
    assert.equal(recovery.model, blockedModel);
    assert.deepEqual(stored.writes, []);
    assert.equal(stored.records.get(SAVE_KEY), '{ damaged save');

    const original = new GameModel();
    original.resumeProduction(100000);
    original.state.coins = 123;
    const originalSave = original.serialize();
    stored.records.set(SAVE_KEY, stored.encode(originalSave));
    const result = recovery.retry();
    assert.equal(result.ok, true, kind);
    assert.equal(recovery.issue, null);
    assert.equal(result.model, recovery.model);
    assert.notEqual(recovery.model, blockedModel);
    assert.deepEqual(recovery.model.serialize(), originalSave);
    assert.deepEqual(stored.writes, [], 'retry reads the save before normal session checkpoints resume');
    const resumed = new ProductionSession({ model: recovery.model, now: () => 100000,
      writeSave: value => stored.platform.writeSave(value) });
    resumed.setReady();
    assert.equal(resumed.canInteract, true);
    assert.deepEqual(clone(stored.platform.readSave()), originalSave);
  }
});

test('restart preserves the raw current and legacy saves before replacing progress and remains blocked on either write failure', () => {
  for (const kind of ['browser', 'douyin']) {
    const stored = storedPlatform(kind, [[SAVE_KEY, '{ damaged save']]);
    const legacy = new GameModel().serialize();
    legacy.coins = 456;
    const rawLegacy = kind === 'browser' ? JSON.stringify(legacy, null, 2) : legacy;
    stored.records.set(LEGACY_SAVE_KEY, rawLegacy);
    const earlierBackup = stored.encode({ backupVersion: 1, createdAt: 1, sourceKey: SAVE_KEY,
      entries: [{ key: SAVE_KEY, value: 'an earlier damaged save' }] });
    stored.records.set(BACKUP_KEY, earlierBackup);
    const recovery = new SaveRecovery(stored.platform);
    const blockedModel = recovery.model;
    const originalRecords = clone([...stored.records]);
    assert.equal(recovery.issue.reason, 'invalid-save', kind);
    assert.deepEqual(stored.writes, [], 'opening recovery does not restart or write a backup');

    stored.faults.backup = true;
    assert.equal(recovery.restart().ok, false);
    assert.equal(recovery.issue.reason, 'backup-failed', kind);
    assert.equal(recovery.model, blockedModel);
    assert.deepEqual([...stored.records], originalRecords, 'backup failure must leave every previous save intact');

    stored.faults.backup = false;
    stored.faults.save = true;
    assert.equal(recovery.restart().ok, false);
    assert.equal(recovery.issue.reason, 'write-failed', kind);
    assert.equal(recovery.model, blockedModel, 'new progress is not playable until its save succeeds');
    assert.equal(stored.records.get(SAVE_KEY), '{ damaged save');
    assert.deepEqual(stored.records.get(LEGACY_SAVE_KEY), rawLegacy);
    assert.deepEqual(stored.records.get(BACKUP_KEY), earlierBackup);
    const backupWrites = stored.writes.filter(item => item.key.startsWith(BACKUP_KEY));
    assert.equal(backupWrites.length, 1);
    const backup = stored.decode(backupWrites[0].value);
    assert.equal(backup.sourceKey, SAVE_KEY);
    assert.deepEqual(backup.entries, [
      { key: SAVE_KEY, value: '{ damaged save' },
      { key: LEGACY_SAVE_KEY, value: rawLegacy },
    ], 'backup preserves raw bytes in the browser and original stored values in Douyin');

    stored.faults.save = false;
    const result = recovery.restart();
    assert.equal(result.ok, true, kind);
    assert.equal(recovery.issue, null);
    assert.equal(recovery.model, result.model);
    assert.notEqual(recovery.model, blockedModel);
    assert.equal(stored.writes.filter(item => item.key.startsWith(BACKUP_KEY)).length, 1,
      'retry reuses the saved backup instead of losing it or consuming more storage');
    assert.equal(stored.writes.at(-1).key, SAVE_KEY);
    assert.deepEqual(clone(stored.platform.readSave()), recovery.model.serialize());
    assert.equal(new GameModel(stored.platform.readSave()).recoveryRequired, false);
    assert.deepEqual(stored.records.get(LEGACY_SAVE_KEY), rawLegacy);
    assert.deepEqual(stored.records.get(BACKUP_KEY), earlierBackup);
  }
});
