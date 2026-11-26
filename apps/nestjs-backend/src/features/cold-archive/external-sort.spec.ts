import { readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IColdRowCodec } from './external-sort';
import { ColdRowSorter } from './external-sort';

interface IRow {
  id: string;
}

const makeCodec = (tmpPrefix: string): IColdRowCodec<IRow> => ({
  compare: (a, b) => a.id.localeCompare(b.id),
  sizeOf: () => 16,
  tmpPrefix,
});

const listRunFiles = async (tmpPrefix: string) =>
  (await readdir(tmpdir())).filter((name) => name.startsWith(`${tmpPrefix}-run-`));

describe('ColdRowSorter', () => {
  it('merges spilled runs in order and dedupes by id', async () => {
    const sorter = new ColdRowSorter(makeCodec('external-sort-spec-merge'), 2);
    for (const id of ['c', 'a', 'b', 'a', 'd']) await sorter.add({ id });

    const out: string[] = [];
    await sorter.drainTo(async (row) => {
      out.push(row.id);
    });

    expect(out).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rejects, instead of raising an unhandled error, when a spilled run file is gone', async () => {
    const tmpPrefix = `external-sort-spec-missing-${process.pid}`;
    // run size 1: every add spills its own run file
    const sorter = new ColdRowSorter(makeCodec(tmpPrefix), 1);
    for (const id of ['a', 'b']) await sorter.add({ id });

    const runFiles = await listRunFiles(tmpPrefix);
    expect(runFiles.length).toBeGreaterThan(0);
    await Promise.all(runFiles.map((name) => unlink(join(tmpdir(), name))));

    await expect(sorter.drainTo(async () => undefined)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await listRunFiles(tmpPrefix)).toEqual([]);
  });
});
