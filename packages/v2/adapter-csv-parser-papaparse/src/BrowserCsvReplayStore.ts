import type { CsvReplayStore } from './CsvReplayStore';

const maxChunkLength = 65_536;
const objectStoreName = 'chunks';

export const createBrowserCsvReplayStore = async (): Promise<CsvReplayStore> => {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is required to replay ambiguous CSV input');
  }
  const factory = indexedDB;
  const databaseName = `teable-csv-replay-${crypto.randomUUID()}`;
  const deleteDatabase = () =>
    new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error('Could not delete CSV replay store'));
      request.onblocked = () => reject(new Error('CSV replay store deletion is blocked'));
    });

  let database: IDBDatabase;
  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      let abandoned = false;
      let upgradeError: unknown;
      request.onupgradeneeded = () => {
        try {
          request.result.createObjectStore(objectStoreName);
        } catch (error) {
          upgradeError = error;
          request.transaction?.abort();
        }
      };
      request.onsuccess = () => {
        if (abandoned) {
          // A blocked open cannot be cancelled; close a late connection so deletion can finish.
          request.result.close();
        } else {
          resolve(request.result);
        }
      };
      request.onerror = () =>
        reject(upgradeError ?? request.error ?? new Error('Could not open CSV replay store'));
      request.onblocked = () => {
        abandoned = true;
        reject(new Error('CSV replay store creation is blocked'));
      };
    });
  } catch (error) {
    await deleteDatabase();
    throw error;
  }

  let committedChunks = 0;
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      database.close();
      await deleteDatabase();
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
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(objectStoreName, 'readwrite');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () =>
            reject(transaction.error ?? new Error('CSV replay append was aborted'));
          try {
            transaction.objectStore(objectStoreName).add(text, committedChunks);
          } catch (error) {
            transaction.abort();
            reject(error);
          }
        });
        committedChunks++;
      } catch (error) {
        await dispose();
        throw error;
      }
    },
    async *read() {
      assertOpen();
      const count = committedChunks;
      try {
        for (let key = 0; key < count; key++) {
          assertOpen();
          const text = await new Promise<string>((resolve, reject) => {
            const transaction = database.transaction(objectStoreName, 'readonly');
            transaction.onabort = () =>
              reject(transaction.error ?? new Error('CSV replay read was aborted'));
            try {
              const request = transaction.objectStore(objectStoreName).get(key);
              transaction.oncomplete = () => {
                const value: unknown = request.result;
                if (typeof value !== 'string' || value.length > maxChunkLength) {
                  reject(new Error('CSV replay chunk is missing or invalid'));
                } else {
                  resolve(value);
                }
              };
            } catch (error) {
              transaction.abort();
              reject(error);
            }
          });
          yield text;
        }
      } catch (error) {
        await dispose();
        throw error;
      }
    },
    dispose,
  };
};
