/**
 * Wire contract for the compute-activity invalidation signal: the app owns the
 * channel name and action key, the adapter only publishes them.
 */
export interface IComputeActivitySignalConfig {
  resolveChannel(tableId: string): string;
  actionKey: string;
}
