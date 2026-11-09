import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, it, vi } from 'vitest';

import { readOptions, temporaryPath } from './profileRuntime';

const tmp = realpathSync('/tmp');
const owned: string[] = [];

function directory(mode: number) {
  const path = mkdtempSync(join(tmp, 'record-update-artifacts-'));
  chmodSync(path, mode);
  owned.push(path);
  return path;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('profile artifact paths', () => {
  it('accepts direct temporary files', () => {
    assert.equal(temporaryPath(join(tmp, 'report.json')), join(tmp, 'report.json'));
  });

  it('accepts owner-only subdirectories', () => {
    const path = directory(0o700);
    assert.equal(temporaryPath(join(path, 'report.json')), join(path, 'report.json'));
  });

  it('rejects group- or world-accessible subdirectories', () => {
    const path = directory(0o755);
    assert.throws(() => temporaryPath(join(path, 'report.json')), /owner-only/);
  });

  it('rejects a private child beneath a replaceable shared ancestor', () => {
    const shared = directory(0o777);
    const child = mkdtempSync(join(shared, 'private-'));
    assert.throws(() => temporaryPath(join(child, 'report.json')), /directly under \/tmp/);
  });

  it('rejects paths that resolve outside the temporary directory', () => {
    assert.throws(() => temporaryPath('/var/tmp/report.json'), /under \/tmp/);
  });
});

describe('profile scenario validation', () => {
  it.each(['', 'timing', '__proto__'])('rejects invalid profile mode %j', (mode) => {
    vi.stubEnv('RECORD_UPDATE_PROFILE_MODE', mode);
    assert.throws(() => readOptions(), /RECORD_UPDATE_PROFILE_MODE must be/);
  });

  it.each(['', 'UNDO', 'replay', 'normal ', '__proto__'])(
    'rejects invalid stack mode %j',
    (stackMode) => {
      vi.stubEnv('RECORD_UPDATE_PROFILE_MODE', 'baseline');
      vi.stubEnv('RECORD_UPDATE_PROFILE_STACK_MODE', stackMode);
      assert.throws(() => readOptions(), /RECORD_UPDATE_PROFILE_STACK_MODE must be/);
    }
  );

  for (const stackMode of ['undo', 'redo']) {
    it.each(['outputReleasedUndoHeld', 'undoCleared'])(
      `rejects undo-held snapshot %s for ${stackMode} replay even with a window`,
      (stage) => {
        vi.stubEnv('RECORD_UPDATE_PROFILE_MODE', 'retention');
        vi.stubEnv('RECORD_UPDATE_PROFILE_STACK_MODE', stackMode);
        vi.stubEnv('RECORD_UPDATE_PROFILE_UNDO', '1');
        vi.stubEnv('RECORD_UPDATE_PROFILE_SNAPSHOT_STAGES', stage);
        assert.throws(() => readOptions(), /requires normal stack mode and UNDO=1/);
      }
    );
  }
});
