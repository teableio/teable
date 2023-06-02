import type { Doc } from '@teable/sharedb/lib/client';
import { isEqual } from 'lodash';
import { useCallback, useContext, useEffect, useState } from 'react';
import { AppContext } from './app/AppContext';

export interface IUseInstancesProps<T, R> {
  collection: string;
  initData?: T[];
  factory: (data: T, doc?: Doc<T>) => R;
  queryParams: unknown;
}

/**
 * Manage instances of a collection, auto subscribe the update and change event, auto create instance,
 * keep every instance the latest data
 * @returns instance[]
 */
export function useInstances<T, R extends { id: string }>({
  collection,
  factory,
  queryParams,
  initData,
}: IUseInstancesProps<T, R>): R[] {
  const { connection } = useContext(AppContext);
  const [queryParamsStorage, setQueryParamsStorage] = useState(queryParams);
  const [instances, setInstances] = useState<R[]>(() => {
    if (initData) {
      return initData.map((data) => factory(data));
    }
    return [];
  });

  useEffect(() => {
    if (!isEqual(queryParams, queryParamsStorage)) {
      setQueryParamsStorage(queryParams);
    }
  }, [queryParams, queryParamsStorage]);

  const updateInstance = useCallback(
    (doc: Doc<T>) => {
      const newInstance = factory(doc.data, doc);
      setInstances((instances) => {
        return instances.map((instance) => {
          if (instance.id === newInstance.id) {
            return newInstance;
          }
          return instance;
        });
      });
    },
    [factory]
  );

  useEffect(() => {
    if (!collection || !connection) {
      return;
    }
    const query = connection.createSubscribeQuery<T>(collection, queryParamsStorage || {});

    query.on('ready', () => {
      console.log(`${collection}:ready:`, query.results);
      setInstances(query.results.map((r) => factory(r.data, r)));
      query.results.forEach((doc) => {
        doc.on('op', (op) => {
          console.log(`${collection} on op:`, op);
          updateInstance(doc);
        });
      });
    });

    query.on('changed', (docs) => {
      console.log(`${collection}:changed:`, docs);
    });

    query.on('insert', (docs, index) => {
      console.log(`${collection}:insert:`, docs, index);
      setInstances((instances) => {
        const newInstances = [...instances];
        docs.forEach((doc) => {
          doc.on('op', (op) => {
            console.log(`${collection} on op:`, op);
            updateInstance(doc);
          });

          newInstances.splice(index, 0, factory(doc.data, doc));
          index++;
        });
        return newInstances;
      });
    });

    query.on('remove', (docs, index) => {
      console.log(`${collection}:remove:`, docs, index);
      setInstances((instances) => {
        const newInstances = [...instances];
        docs.forEach((doc) => {
          doc.removeAllListeners('op');
          newInstances.splice(index, 1);
        });
        return newInstances;
      });
    });

    query.on('move', (docs, from, to) => {
      console.log(`${collection}:move:`, docs, from, to);
      setInstances((instances) => {
        return query.results.map((doc) => {
          const instance = instances.find((item) => item.id === doc.id);
          if (!instance) {
            throw new Error('Cannot find moved item');
          }
          return instance;
        });
      });
    });

    return () => {
      query.destroy();
      query.results &&
        query.results.forEach((doc) => {
          doc.removeAllListeners('op');
        });
    };
  }, [connection, collection, updateInstance, queryParamsStorage, factory]);

  return instances;
}
