import { isEqual } from 'lodash';
import { useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import type { Doc, Query } from 'sharedb/lib/client';
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

const queryDestroy = (query: Query | undefined, cb?: () => void) => {
  if (!query) {
    return;
  }
  if (!query.sent || query.ready) {
    query?.destroy(cb);
    return;
  }
  query.once('ready', () => {
    query.destroy(() => {
      query.removeAllListeners();
      cb?.();
    });
  });
};

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
  const { connection, connected } = useContext(AppContext);
  const [query, setQuery] = useState<Query<T>>();
  const [instances, dispatch] = useReducer(
    (state: R[], action: IInstanceAction<T>) => instanceReducer(state, action, factory),
    initData && !connected ? initData.map((data) => factory(data)) : []
  );

  const opListeners = useRef<OpListenersManager<T>>(new OpListenersManager<T>(collection));
  const preQueryRef = useRef<Query<T>>();

  const handleReady = useCallback((query: Query<T>) => {
    console.log(
      `${query.collection}:ready:`,
      query.query,
      localStorage.getItem('debug') && query.results.map((doc) => doc.data)
    );
    // ready event will be triggered multiple times, so we need to clear the op listeners first
    opListeners.current.clear();
    if (!query.results) {
      return;
    }
    dispatch({ type: 'ready', results: query.results });
    query.results.forEach((doc) => {
      opListeners.current.add(doc, (op) => {
        console.log(`${query.collection} on op:`, op, doc);
        dispatch({ type: 'update', doc });
      });
    });
  }, []);

  const handleInsert = useCallback((docs: Doc<T>[], index: number) => {
    console.log(
      `${docs[0]?.collection}:insert:`,
      docs.map((doc) => doc.id),
      index
    );
    dispatch({ type: 'insert', docs, index });

    docs.forEach((doc) => {
      opListeners.current.add(doc, (op) => {
        console.log(`${docs[0]?.collection} on op:`, op);
        dispatch({ type: 'update', doc });
      });
    });
  }, []);

  const handleRemove = useCallback((docs: Doc<T>[], index: number) => {
    console.log(
      `${docs[0]?.collection}:remove:`,
      docs.map((doc) => doc.id),
      index
    );
    dispatch({ type: 'remove', docs, index });
    docs.forEach((doc) => {
      opListeners.current.remove(doc);
    });
  }, []);

  const handleMove = useCallback((docs: Doc<T>[], from: number, to: number) => {
    console.log(
      `${docs[0]?.collection}:move:`,
      docs.map((doc) => doc.id),
      from,
      to
    );
    dispatch({ type: 'move', docs, from, to });
  }, []);

  useEffect(() => {
    setQuery((query) => {
      if (!collection || !connection) {
        return undefined;
      }
      if (query && isEqual(queryParams, query.query) && collection === query.collection) {
        return query;
      }

      // Avoid executing setQuery twice for the first rendering in react strict mode,
      // which will result in query being undefined but preQueryRef.current is already initialized
      if (!query && preQueryRef.current) {
        return preQueryRef.current;
      }

      queryDestroy(preQueryRef.current);
      const newQuery = connection.createSubscribeQuery<T>(collection, queryParams);
      preQueryRef.current = newQuery;
      return newQuery;
    });
  }, [connection, collection, queryParams]);

  useEffect(() => {
    return () => {
      // for easy component refresh clean data when switch & loading
      dispatch({ type: 'clear' });
      // eslint-disable-next-line react-hooks/exhaustive-deps
      queryDestroy(query, () => opListeners.current.clear());
    };
  }, [query]);

  useEffect(() => {
    if (!query) {
      return;
    }

    const readyListener = () => handleReady(query);
    const changedListener = (docs: Doc<T>[]) => {
      console.log(
        `${docs[0]?.collection}:changed:`,
        docs.map((doc) => doc.id)
      );
    };

    query.on('ready', readyListener);

    query.on('changed', changedListener);

    query.on('insert', handleInsert);

    query.on('remove', handleRemove);

    query.on('move', handleMove);

    return () => {
      query.removeListener('ready', readyListener);
      query.removeListener('changed', changedListener);
      query.removeListener('insert', handleInsert);
      query.removeListener('remove', handleRemove);
      query.removeListener('move', handleMove);
    };
  }, [query, handleInsert, handleRemove, handleMove, handleReady]);

  return instances;
}
