import { createHash } from 'node:crypto';
import nodeFs, { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { ClsService } from 'nestjs-cls';
import { vi, type MockInstance } from 'vitest';
import type { CacheService } from '../../../cache/cache.service';
import type { IBaseConfig } from '../../../configs/base.config';
import type { IStorageConfig } from '../../../configs/storage';
import type { IClsStore } from '../../../types/cls';
import { LocalStorage } from './local';

const promiseWithResolvers = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
  };
};

describe('LocalStorage upload cancellation', () => {
  it('closes the source before rejection, preserves an existing destination, and accepts the next upload', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'teable-local-upload-'));
    // This filesystem-only contract uses local settings; cache, CLS, and URL
    // configuration are constructor seams outside the upload path.
    const storage = new LocalStorage(
      {
        local: { path: directory },
        encryption: {
          entries: [{ algorithm: 'aes-128-cbc', key: '73b00476e456323e', iv: '8c9183e4c175f63c' }],
        },
      } as IStorageConfig,
      {} as IBaseConfig,
      {} as CacheService,
      {} as ClsService<IClsStore>
    );
    const controller = new AbortController();
    const started = promiseWithResolvers.withResolvers<void>();
    let supplied = false;
    const source = new Readable({
      read() {
        if (supplied) return;
        supplied = true;
        this.push(Buffer.alloc(64 * 1024));
        started.resolve();
      },
    });
    try {
      await fs.mkdir(join(directory, 'private-bucket'));
      const destination = join(directory, 'private-bucket', 'existing');
      await fs.writeFile(destination, 'existing bytes');
      const upload = storage.uploadFileStream(
        'private-bucket',
        'existing',
        source,
        undefined,
        controller.signal
      );
      const rejected = expect(upload).rejects.toHaveProperty('name', 'AbortError');
      await started.promise;
      controller.abort(new Error('local export cancelled'));
      await rejected;
      expect(source.closed).toBe(true);
      expect(await fs.readFile(destination, 'utf8')).toBe('existing bytes');

      for (const input of [Buffer.from('next bytes'), Readable.from(['next bytes'])]) {
        await expect(
          storage.uploadFileStream(
            'private-bucket',
            'next',
            input,
            undefined,
            new AbortController().signal
          )
        ).resolves.toEqual({
          hash: createHash('sha256').update('next bytes').digest('hex'),
          path: 'next',
        });
        expect(await fs.readFile(join(directory, 'private-bucket', 'next'), 'utf8')).toBe(
          'next bytes'
        );
      }

      await expect(
        storage.uploadFileStream(
          'private-bucket',
          'existing',
          Buffer.from('replacement'),
          undefined,
          controller.signal
        )
      ).rejects.toThrow('local export cancelled');
      expect(await fs.readFile(destination, 'utf8')).toBe('existing bytes');
    } finally {
      controller.abort();
      source.destroy();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves the old object when replacement is cancelled after a storage file opens for writing', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'teable-local-publish-'));
    const storage = new LocalStorage(
      {
        local: { path: directory },
        encryption: {
          entries: [{ algorithm: 'aes-128-cbc', key: '73b00476e456323e', iv: '8c9183e4c175f63c' }],
        },
      } as IStorageConfig,
      {} as IBaseConfig,
      {} as CacheService,
      {} as ClsService<IClsStore>
    );
    const controller = new AbortController();
    const realCreateWriteStream = nodeFs.createWriteStream;
    let cancelStorageWrite = true;
    const writerBoundary = vi
      .spyOn(nodeFs, 'createWriteStream')
      .mockImplementation((...args: Parameters<typeof realCreateWriteStream>) => {
        const writer = realCreateWriteStream(...args);
        const filePath = args[0];
        if (
          cancelStorageWrite &&
          typeof filePath === 'string' &&
          filePath.startsWith(`${directory}${sep}`)
        ) {
          cancelStorageWrite = false;
          writer.once('open', () => controller.abort(new Error('cancel replacement write')));
        }
        return writer;
      });
    syncBuiltinESMExports();
    try {
      const bucket = join(directory, 'private-bucket');
      await fs.mkdir(bucket);
      const destination = join(bucket, 'existing');
      await fs.writeFile(destination, 'old object bytes');

      await expect(
        storage.uploadFileStream(
          'private-bucket',
          'existing',
          Readable.from([Buffer.alloc(64 * 1024, 'x')]),
          undefined,
          controller.signal
        )
      ).rejects.toHaveProperty('name', 'AbortError');
      expect(controller.signal.aborted).toBe(true);
      expect(await fs.readFile(destination, 'utf8')).toBe('old object bytes');
      expect(await fs.readdir(directory)).toEqual(['private-bucket']);
      expect(await fs.readdir(bucket)).toEqual(['existing']);

      await expect(
        storage.uploadFileStream(
          'private-bucket',
          'existing',
          Readable.from(['published replacement']),
          undefined,
          new AbortController().signal
        )
      ).resolves.toEqual({
        hash: createHash('sha256').update('published replacement').digest('hex'),
        path: 'existing',
      });
      expect(await fs.readFile(destination, 'utf8')).toBe('published replacement');
      expect(await fs.readdir(directory)).toEqual(['private-bucket']);
      expect(await fs.readdir(bucket)).toEqual(['existing']);
    } finally {
      writerBoundary.mockRestore();
      syncBuiltinESMExports();
      controller.abort();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['removed', 'replaced'] as const)(
    'preserves the published destination when staging is %s before publication',
    async (change) => {
      const directory = await fs.mkdtemp(join(tmpdir(), 'teable-local-staging-owner-'));
      const storage = new LocalStorage(
        {
          local: { path: directory },
          encryption: {
            entries: [{ algorithm: 'aes-128-cbc', key: '73b00476e456323e', iv: '8c9183e4c175f63c' }],
          },
        } as IStorageConfig,
        {} as IBaseConfig,
        {} as CacheService,
        {} as ClsService<IClsStore>
      );
      const destination = join(directory, 'private-bucket', 'existing');
      await fs.mkdir(dirname(destination));
      await fs.writeFile(destination, 'existing export');
      const writeFile = fs.writeFile.bind(fs);
      let stagingDirectory = '';
      const boundary = vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
        await writeFile(...args);
        stagingDirectory = dirname(args[0].toString());
        if (change === 'removed') {
          await fs.rm(stagingDirectory, { recursive: true });
        } else {
          await fs.rename(stagingDirectory, `${stagingDirectory}-old`);
          await fs.mkdir(stagingDirectory);
          await writeFile(join(stagingDirectory, 'content'), 'another uploader');
        }
      });
      try {
        await expect(
          storage.uploadFileStream(
            'private-bucket',
            'existing',
            Buffer.from('replacement export'),
            undefined,
            new AbortController().signal
          )
        ).rejects.toThrow(
          change === 'removed' ? 'ENOENT' : 'Local upload staging directory changed before publication'
        );
        expect(await fs.readFile(destination, 'utf8')).toBe('existing export');
        if (change === 'replaced') {
          expect(await fs.readFile(join(stagingDirectory, 'content'), 'utf8')).toBe('another uploader');
        }
      } finally {
        boundary.mockRestore();
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('refreshes a live staging directory through its open handle', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'teable-local-staging-heartbeat-'));
    const storage = new LocalStorage(
      {
        local: { path: directory },
        encryption: {
          entries: [{ algorithm: 'aes-128-cbc', key: '73b00476e456323e', iv: '8c9183e4c175f63c' }],
        },
      } as IStorageConfig,
      {} as IBaseConfig,
      {} as CacheService,
      {} as ClsService<IClsStore>
    );
    const started = promiseWithResolvers.withResolvers<void>();
    const resume = promiseWithResolvers.withResolvers<void>();
    const source = Readable.from(
      (async function* () {
        started.resolve();
        yield 'first bytes';
        await resume.promise;
        yield 'last bytes';
      })()
    );
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const open = fs.open.bind(fs);
    let heartbeat: MockInstance<FileHandle['utimes']> | undefined;
    const boundary = vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await open(...args);
      heartbeat = vi.spyOn(handle, 'utimes');
      return handle;
    });
    const upload = storage.uploadFileStream(
      'private-bucket',
      'existing',
      source,
      undefined,
      new AbortController().signal
    );
    try {
      await started.promise;
      const bucket = join(directory, 'private-bucket');
      const [stagingDirectory] = await fs.readdir(bucket);
      const stagingPath = join(bucket, stagingDirectory);
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await fs.utimes(stagingPath, old, old);

      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(heartbeat).toHaveBeenCalledOnce();
      await heartbeat?.mock.results[0].value;
      expect((await fs.stat(stagingPath)).mtimeMs).toBeGreaterThan(old.getTime());
      resume.resolve();
      await upload;
      expect(await fs.readdir(bucket)).toEqual(['existing']);
    } finally {
      resume.resolve();
      try {
        await upload;
      } finally {
        boundary.mockRestore();
        vi.useRealTimers();
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  });
});
