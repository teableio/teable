import type { Doc } from '@teable/sharedb/lib/client';

export type IInstanceAction<T> =
  | { type: 'update'; doc: Doc<T> }
  | { type: 'ready'; results: Doc<T>[] }
  | { type: 'insert'; docs: Doc<T>[]; index: number }
  | { type: 'remove'; docs: Doc<T>[]; index: number }
  | { type: 'move'; docs: Doc<T>[]; from: number; to: number }
  | { type: 'clear' };

export function instanceReducer<T, R extends { id: string }>(
  state: R[],
  action: IInstanceAction<T>,
  factory: (data: T, doc?: Doc<T>) => R
): R[] {
  switch (action.type) {
    case 'update': {
      const newInstance = factory(action.doc.data, action.doc);
      return state.map((instance) => {
        if (instance.id === action.doc.id) {
          newInstance;
        }
        return instance;
      });
    }
    case 'ready':
      return action.results.map((r) => factory(r.data, r));
    case 'insert':
      return [
        ...state.slice(0, action.index),
        ...action.docs.map((doc) => factory(doc.data, doc)),
        ...state.slice(action.index),
      ];
    case 'remove':
      return [...state.slice(0, action.index), ...state.slice(action.index + action.docs.length)];
    case 'move':
      return action.docs.map((doc) => {
        const instance = state.find((item) => item.id === doc.id);
        if (!instance) {
          throw new Error('Cannot find moved item');
        }
        return instance;
      });
    case 'clear': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (state[0] && (state[0] as any).doc) {
        return [];
      }
      return state;
    }
    default:
      return state;
  }
}
