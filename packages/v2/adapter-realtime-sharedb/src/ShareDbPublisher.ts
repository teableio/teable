import type { Result } from 'neverthrow';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';

export type ShareDbOp = CreateOp | DeleteOp | EditOp;

export interface IShareDbOpPublisher {
  publish(channels: ReadonlyArray<string>, op: ShareDbOp): Promise<Result<void, string>>;
}
