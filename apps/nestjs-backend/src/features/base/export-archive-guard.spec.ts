import { PassThrough, Readable } from 'node:stream';
import archiver from 'archiver';
import * as unzipper from 'unzipper';
import { describe, expect, it } from 'vitest';
import { EXPORT_ZIP_OPTIONS, guardExportArchive } from './export-archive-guard';

const createArchive = () => {
  const output = new PassThrough();
  const archive = archiver('zip', EXPORT_ZIP_OPTIONS);
  const guard = guardExportArchive(archive, output);
  archive.pipe(output);
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  return { archive, guard, output, zip: () => Buffer.concat(chunks) };
};

const neverSettles = async (promise: Promise<unknown>, ms = 200) => {
  const pending = Symbol('pending');
  const result = await Promise.race([
    promise.then(
      () => 'resolved',
      () => 'rejected'
    ),
    new Promise((resolve) => setTimeout(() => resolve(pending), ms)),
  ]);
  return result === pending;
};

describe('guardExportArchive', () => {
  it('finalizes normally and deflates every entry, including already-compressed ones', async () => {
    const { archive, guard, zip } = createArchive();
    async function* rows() {
      yield 'a,b\n';
      yield '1,2\n';
    }
    archive.append(Readable.from(rows()), { name: 'tables/tbl.csv' });
    archive.append(Readable.from([Buffer.from('pptx-bytes')]), { name: 'attachments/abc.pptx' });

    await guard.run(archive.finalize());

    const directory = await unzipper.Open.buffer(zip());
    const entries = Object.fromEntries(directory.files.map((file) => [file.path, file]));
    expect((await entries['tables/tbl.csv'].buffer()).toString()).toBe('a,b\n1,2\n');
    expect(entries['tables/tbl.csv'].compressionMethod).toBe(8);
    expect((await entries['attachments/abc.pptx'].buffer()).toString()).toBe('pptx-bytes');
    expect(entries['attachments/abc.pptx'].compressionMethod).toBe(8);
  });

  it('rejects instead of hanging when an entry source errors', async () => {
    // Baseline: without the guard archiver never settles finalize() here.
    const unguarded = archiver('zip');
    unguarded.pipe(new PassThrough().resume());
    const failing = Readable.from(
      (async function* () {
        yield 'a';
        throw new Error('db gone');
      })()
    );
    failing.on('error', () => undefined);
    unguarded.append(failing, { name: 't.csv' });
    expect(await neverSettles(unguarded.finalize())).toBe(true);

    const { archive, guard, output } = createArchive();
    const queued = Readable.from(['x']);
    archive.append(
      Readable.from(
        (async function* () {
          yield 'a,b\n';
          throw new Error('Connection terminated unexpectedly');
        })()
      ),
      { name: 'tables/a.csv' }
    );
    archive.append(queued, { name: 'tables/b.csv' });

    await expect(guard.run(archive.finalize())).rejects.toThrow(
      'Export entry tables/a.csv failed: Connection terminated unexpectedly'
    );
    expect(output.destroyed).toBe(true);
    expect(queued.destroyed).toBe(true);
    expect(() => archive.append('late', { name: 'late.txt' })).toThrow(
      'Export entry tables/a.csv failed'
    );
  });

  it('rejects when an entry source is closed before it ends', async () => {
    const { archive, guard } = createArchive();
    const source = new PassThrough();
    source.write('partial');
    archive.append(source, { name: 'attachments/file.bin' });
    const finalized = guard.run(archive.finalize());

    source.destroy();

    await expect(finalized).rejects.toThrow(
      'Export entry attachments/file.bin closed before it finished'
    );
  });

  it('stops pending work when failed from outside, e.g. by the upload', async () => {
    const { archive, guard, output } = createArchive();
    let generatorStopped = false;
    async function* slowRows() {
      try {
        for (let i = 0; ; i++) {
          yield `${i}\n`;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      } finally {
        generatorStopped = true;
      }
    }
    archive.append(Readable.from(slowRows()), { name: 'tables/big.csv' });
    const finalized = guard.run(archive.finalize());

    setTimeout(() => guard.fail(new Error('S3 upload failed: RequestTimeout')), 30);

    await expect(finalized).rejects.toThrow('S3 upload failed: RequestTimeout');
    expect(output.destroyed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(generatorStopped).toBe(true);
  });

  it('keeps the first failure when several sources fail', async () => {
    const { archive, guard } = createArchive();
    const first = new PassThrough();
    const second = new PassThrough();
    archive.append(first, { name: 'one.csv' });
    archive.append(second, { name: 'two.csv' });
    const finalized = guard.run(archive.finalize());

    first.destroy(new Error('first'));
    second.destroy(new Error('second'));

    await expect(finalized).rejects.toThrow('Export entry one.csv failed: first');
  });
});
