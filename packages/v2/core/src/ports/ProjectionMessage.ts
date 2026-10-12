import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { EventType } from './EventHandler';
import type { UnitOfWorkScope } from './ExecutionContext';

export type ProjectionMessageJsonPrimitive = boolean | number | string | null;

export type ProjectionMessageJson =
  | ProjectionMessageJsonPrimitive
  | ReadonlyArray<ProjectionMessageJson>
  | { readonly [key: string]: ProjectionMessageJson };

export type ProjectionMessageRoute = Readonly<{
  transactionScope: UnitOfWorkScope;
  baseId?: string;
  tableId?: string;
  streamKey?: string;
  operationId?: string;
}>;

export type EncodedProjectionMessage = Readonly<{
  producerEventName: string;
  messageName: string;
  schemaVersion: number;
  payload: ProjectionMessageJson;
  route: ProjectionMessageRoute;
}>;

export type ProjectionMessageDecoderIdentity = Readonly<{
  messageName: string;
  schemaVersion: number;
}>;

export interface IProjectionMessageCodec<
  TEvent extends IDomainEvent = IDomainEvent,
  TMessage extends ProjectionMessageJson = ProjectionMessageJson,
> {
  readonly eventType: EventType<TEvent>;
  readonly messageName: string;
  readonly schemaVersion: number;
  encode(event: TEvent): Result<TMessage, DomainError>;
  decode(payload: ProjectionMessageJson): Result<TMessage, DomainError>;
  route(event: TEvent): ProjectionMessageRoute;
}

export interface IProjectionMessageCodecRegistry {
  registeredDecoderIdentities(): ReadonlyArray<ProjectionMessageDecoderIdentity>;
  encode(event: IDomainEvent): Result<EncodedProjectionMessage, DomainError>;
  decode(
    messageName: string,
    schemaVersion: number,
    payload: ProjectionMessageJson
  ): Result<ProjectionMessageJson, DomainError>;
}
