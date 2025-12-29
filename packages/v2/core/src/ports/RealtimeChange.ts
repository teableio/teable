export type RealtimePathSegment = string | number;
export type RealtimePath = ReadonlyArray<RealtimePathSegment>;

export type RealtimeChange =
  | { type: 'set'; path: RealtimePath; value: unknown }
  | { type: 'insert'; path: RealtimePath; index: number; value: unknown }
  | { type: 'delete'; path: RealtimePath; index: number; count: number };
