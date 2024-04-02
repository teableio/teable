export interface ISnapshotBase<T = unknown> {
  id: string;
  v: number;
  type: string | null;
  data: T;
  m?: unknown;
}
