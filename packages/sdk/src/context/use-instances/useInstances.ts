import type { Doc, Query } from '@teable/sharedb/lib/client';
import { isEqual } from 'lodash';
import { useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { AppContext } from '../app/AppContext';
import { OpListenersManager } from './opListener';
import type { IInstanceAction } from './reducer';
import { instanceReducer } from './reducer';

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
  const [query, setQuery] = useState<Query<T>>();
  const [instances, dispatch] = useReducer(
    (state: R[], action: IInstanceAction<T>) => instanceReducer(state, action, factory),
    initData ? initData.map((data) => factory(data)) : []
  );

  const opListeners = useRef<OpListenersManager<T>>(new OpListenersManager<T>(collection));

  const handleReady = useCallback((query: Query<T>) => {
    console.log(`${query.collection}:ready:`, query.results);
    dispatch({ type: 'ready', results: query.results });
    query.results.forEach((doc) => {
      opListeners.current.add(doc, (op) => {
        console.log(`${query.collection} on op:`, op);
        dispatch({ type: 'update', doc });
      });
    });
  }, []);

  const handleInsert = useCallback((docs: Doc<T>[], index: number) => {
    console.log(`${docs[0]?.collection}:insert:`, docs, index);
    dispatch({ type: 'insert', docs, index });

    docs.forEach((doc) => {
      opListeners.current.add(doc, (op) => {
        console.log(`${docs[0]?.collection} on op:`, op);
        dispatch({ type: 'update', doc });
      });
    });
  }, []);

  const handleRemove = useCallback((docs: Doc<T>[], index: number) => {
    console.log(`${docs[0]?.collection}:remove:`, docs, index);
    dispatch({ type: 'remove', docs, index });
    docs.forEach((doc) => {
      opListeners.current.remove(doc);
    });
  }, []);

  const handleMove = useCallback((docs: Doc<T>[], from: number, to: number) => {
    console.log(`${docs[0]?.collection}:move:`, docs, from, to);
    dispatch({ type: 'move', docs, from, to });
  }, []);

  useEffect(() => {
    if (!collection || !connection) {
      return;
    }
    if (query && isEqual(queryParams, query.query)) {
      return;
    }
    // for easy component refresh clean data when switch & loading
    dispatch({ type: 'clear' });
    setQuery(connection.createSubscribeQuery<T>(collection, queryParams || {}));
    const opListenersRef = opListeners.current;

    return () => {
      const clear = () => {
        query?.removeAllListeners();
        opListenersRef.clear();
      };
      clear();
      if (!query?.sent || query.ready) {
        query?.destroy();
        return;
      }
      query.once('ready', () => {
        query.destroy(clear);
      });
    };
  }, [connection, collection, queryParams, query]);

  useEffect(() => {
    if (!query) {
      return;
    }
    dispatch({ type: 'clear' });

    query.on('ready', () => handleReady(query));

    query.on('changed', (docs) => {
      console.log(`${docs[0]?.collection}:changed:`, docs);
    });

    query.on('insert', handleInsert);

    query.on('remove', handleRemove);

    query.on('move', handleMove);
  }, [query, handleInsert, handleRemove, handleMove, handleReady]);

  return instances;
}
