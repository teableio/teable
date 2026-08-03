import { parentPort, workerData } from 'worker_threads';
import { getRandomString } from '@teable/core';
import type { IImportConstructorParams } from '../features/import/open-api/import.class';
import { importerFactory } from '../features/import/open-api/import.class';

const parse = () => {
  const { config, options, id } = { ...workerData } as {
    config: IImportConstructorParams;
    options: {
      skipFirstNLines: number;
      key: string;
    };
    id: string;
  };
  const importer = importerFactory(config.type, config);
  importer.parse(
    { ...options },
    async (chunk, lastChunk) => {
      return await new Promise((resolve) => {
        const chunkId = `chunk_${getRandomString(8)}`;
        parentPort?.postMessage({ type: 'chunk', data: chunk, chunkId, id, lastChunk });
        parentPort?.on('message', (result) => {
          const { type, chunkId: tunnelChunkId } = result;
          if (type === 'done' && tunnelChunkId === chunkId) {
            resolve();
          }
        });
      });
    },
    () => {
      parentPort?.postMessage({ type: 'finished', id });
      parentPort?.close();
    },
    (error) => {
      parentPort?.postMessage({ type: 'error', data: error, id });
      parentPort?.close();
    }
  );
};

parse();
