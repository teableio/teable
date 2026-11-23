import { describe, expect, it } from 'vitest';
import { isBackendOnlyObjectKey } from './backend-only';

describe('isBackendOnlyObjectKey', () => {
  it.each([
    'record-history/v1/tblVictim/_stats.json',
    'record-history/v1/tblVictim/202611/01-p0-recA.ndjson.zst',
    'record-removal/v1/tblVictim/delete/_stats.json',
    'workflow-run/2026/part.ndjson.zst',
    'audit-log/2026/part.ndjson.zst',
    'artifact/art1/index.html',
    'record-history',
    '/record-history/v1/tblVictim/_stats.json',
    './record-history/v1/tblVictim/_stats.json',
    '../record-history/v1/tblVictim/_stats.json',
    'table/../record-history/v1/tblVictim/_stats.json',
    'table//x/../../record-history/v1/tblVictim/_stats.json',
    'table\\..\\record-history\\v1\\tblVictim\\_stats.json',
  ])('is true for %s', (key) => {
    expect(isBackendOnlyObjectKey(key)).toBe(true);
  });

  it.each([
    'table/tok123',
    'table/tok123_lg.webp',
    'table/record-history/v1/tblVictim/_stats.json',
    'comment/tok123',
    'export-base/tok123',
    // not a backend-only type, and only shares a prefix with one
    'artifact-thumbnail/art1.webp',
    'record-history-notes/tok123',
    '',
  ])('is false for %s', (key) => {
    expect(isBackendOnlyObjectKey(key)).toBe(false);
  });
});
