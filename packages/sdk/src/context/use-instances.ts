import type { Doc } from '@teable/sharedb/lib/client';
import { isEqual } from 'lodash';
import { useCallback, useContext, useEffect, useState } from 'react';
import { createMemo } from 'react-use';
import { AppContext } from './app/AppContext';

export interface IUseInstancesProps<T, R> {
  collection: string;
  initData?: T[];
  factory: (data: T, doc?: Doc<T>) => R;
  queryParams: unknown;
}

const memoEqual = () => {
  let pre: unknown;
  return function inner(cur: unknown) {
    if (!isEqual(pre, cur)) {
      pre = cur;
    }
    return pre;
  };
};

const useMemoEqual = createMemo(memoEqual());

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
  const [instance, setInstances] = useState<R[]>(() => {
    if (initData) {
      return initData.map((data) => factory(data));
    }
    return [];
  });

  queryParams = useMemoEqual(queryParams);

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
    const query = connection.createSubscribeQuery<T>(collection, queryParams || {});

    query.on('ready', () => {
      console.log(`${collection}:ready:`, query.results);
      setInstances(query.results.map((r) => factory(r.data, r)));
      query.results.forEach((doc) => {
        doc.on('op', (op) => {
          console.log('doc on op:', op);
          updateInstance(doc);
        });
      });
    });

    query.on('changed', () => {
      console.log(`${collection}:changed:`, query.results);
      setInstances(query.results.map((doc) => factory(doc.data, doc)));
    });

    query.on('insert', (docs) => {
      docs.forEach((doc) => {
        doc.on('op', (op) => {
          console.log(`${collection} on op:`, op);
          updateInstance(doc);
        });
      });
    });

    query.on('remove', (docs) => {
      docs.forEach((doc) => {
        doc.removeAllListeners('op');
      });
    });

    return () => {
      query.destroy();
      query.results &&
        query.results.forEach((doc) => {
          doc.removeAllListeners('op');
        });
    };
  }, [connection, collection, updateInstance, queryParams, factory]);

  return instance;
}
