import { type DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';

export type ShareDbCollectionInvalidationOp = Omit<EditOp, 'd'> & {
  d?: undefined;
};

export type ShareDbOp = CreateOp | DeleteOp | EditOp | ShareDbCollectionInvalidationOp;

export interface IShareDbOpPublisher {
  publish(channels: ReadonlyArray<string>, op: ShareDbOp): Promise<Result<void, DomainError>>;
}
