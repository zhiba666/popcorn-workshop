'use strict';

const { GameModel } = require('../domain/game-model');

// Reading and restarting never hand the application a replacement model until
// the operation succeeds. The application keeps gameplay and autosave blocked
// while issue is present.
class SaveRecovery {
  constructor(platform) {
    this.platform = platform;
    this.model = new GameModel();
    this.issue = null;
    this.retry();
  }

  fail(reason, error) {
    this.issue = { reason, error };
    return { ok: false, issue: this.issue };
  }

  retry() {
    let saved;
    try { saved = this.platform.readSave(); }
    catch (error) {
      return this.fail(error.code === 'invalid-save' ? 'invalid-save' : 'read-failed', error);
    }
    let model;
    try { model = new GameModel(saved); }
    catch (error) { return this.fail('invalid-save', error); }
    if (model.recoveryRequired) return this.fail('invalid-save', new Error('存档内容未通过校验'));
    this.model = model;
    this.issue = null;
    return { ok: true, model };
  }

  restart() {
    if (!this.issue) return { ok: false, reason: 'recovery-not-required' };
    const model = new GameModel();
    const resumed = model.resumeProduction(this.platform.now());
    if (!resumed.ok) return this.fail('write-failed', new Error('新存档初始化失败：' + resumed.reason));
    try { this.platform.backupAndWriteSave(model.serialize()); }
    catch (error) {
      return this.fail(error.code === 'write-failed' ? 'write-failed' : 'backup-failed', error);
    }
    this.model = model;
    this.issue = null;
    return { ok: true, model };
  }
}

module.exports = { SaveRecovery };
