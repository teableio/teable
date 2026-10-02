import type { FileHandle } from 'node:fs/promises';
import type { CsvReplayStore } from './CsvReplayStore';

const maxChunkLength = 65_536;
const headerLength = 4;

export const createNodeCsvReplayStore = async (
  options: { temporaryDirectory?: string } = {}
): Promise<CsvReplayStore> => {
  // Runtime-only builtins keep this adapter importable by browser bundles.
  const { promises: fs } = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const directory = await fs.mkdtemp(
    path.join(options.temporaryDirectory ?? os.tmpdir(), 'teable-csv-replay-')
  );
  let file: FileHandle;
  try {
    await fs.chmod(directory, 0o700);
    file = await fs.open(path.join(directory, 'chunks'), 'wx+', 0o600);
    try {
      await file.chmod(0o600);
    } catch (error) {
      await file.close();
      throw error;
    }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }

  let committedBytes = 0;
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      try {
        await file.close();
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    })();
    return disposal;
  };
  const assertOpen = () => {
    if (disposal) throw new Error('CSV replay store is disposed');
  };

  return {
    async append(text) {
      assertOpen();
      try {
        if (text.length > maxChunkLength)
          throw new Error('CSV replay chunk exceeds 65536 code units');
        const frame = Buffer.allocUnsafe(headerLength + text.length * 2);
        frame.writeUInt32LE(text.length, 0);
        // Buffer's UTF-16 encoding preserves lone surrogate code units, unlike UTF-8.
        frame.write(text, headerLength, 'utf16le');
        let written = 0;
        while (written < frame.length) {
          const { bytesWritten } = await file.write(
            frame,
            written,
            frame.length - written,
            committedBytes + written
          );
          if (bytesWritten === 0) throw new Error('CSV replay write made no progress');
          written += bytesWritten;
        }
        committedBytes += frame.length;
      } catch (error) {
        await dispose();
        throw error;
      }
    },
    async *read() {
      assertOpen();
      const end = committedBytes;
      const frame = Buffer.allocUnsafe(maxChunkLength * 2);
      let position = 0;
      const readExactly = async (length: number) => {
        let received = 0;
        while (received < length) {
          const { bytesRead } = await file.read(
            frame,
            received,
            length - received,
            position + received
          );
          if (bytesRead === 0) throw new Error('CSV replay file is truncated');
          received += bytesRead;
        }
        position += length;
      };
      try {
        while (position < end) {
          assertOpen();
          await readExactly(headerLength);
          const length = frame.readUInt32LE(0);
          if (length > maxChunkLength || position + length * 2 > end) {
            throw new Error('CSV replay frame has an invalid length');
          }
          await readExactly(length * 2);
          yield frame.toString('utf16le', 0, length * 2);
        }
      } catch (error) {
        await dispose();
        throw error;
      }
    },
    dispose,
  };
};
