import type { Doc } from 'sharedb/lib/client';

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
      return state.map((instance) => {
        if (instance.id === action.doc.id) {
          return factory(action.doc.data, action.doc);
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
    case 'move': {
      const { docs, from, to } = action;
      const newInstance = [...state];
      const moveInstance = newInstance.splice(from, docs.length);
      newInstance.splice.apply(newInstance, [to, 0, ...moveInstance]);
      return newInstance;
    }
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
