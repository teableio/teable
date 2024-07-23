import { parentPort, workerData } from 'worker_threads';
import type { IImportConstructorParams } from '../features/import/open-api/import.class';
import { importerFactory } from '../features/import/open-api/import.class';

const parse = () => {
  const { config, options } = { ...workerData } as {
    config: IImportConstructorParams;
    options: {
      skipFirstNLines: number;
      key: string;
    };
  };
  const importer = importerFactory(config.type, config);
  importer.parse(
    { ...options },
    (chunk) => {
      return new Promise((resolve) => {
        parentPort?.postMessage({ type: 'chunk', data: chunk });
        parentPort?.on('message', (result) => {
          const { type } = result;
          if (type === 'done') {
            resolve();
          }
        });
      });
    },
    () => {
      parentPort?.postMessage({ type: 'finished' });
      parentPort?.close();
    },
    (error) => {
      parentPort?.postMessage({ type: 'error', data: error });
      parentPort?.close();
    }
  );
};

parse();
