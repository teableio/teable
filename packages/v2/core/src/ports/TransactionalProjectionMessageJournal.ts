import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { DurableProjectionTarget } from './DurableSubscriptionCatalog';
import type { IExecutionContext } from './ExecutionContext';
import type { ProjectionMessageJson, ProjectionMessageRoute } from './ProjectionMessage';

export type StoredProjectionMessageContext = Readonly<{
  actorId: string;
  requestId?: string;
  windowId?: string;
  undoRedoMode?: 'undo' | 'redo' | 'normal';
  correlationId?: string;
  causationId?: string;
}>;

export type ProjectionMessageDraft = Readonly<{
  eventId: string;
  producerEventName: string;
  messageName: string;
  schemaVersion: number;
  payload: ProjectionMessageJson;
  route: ProjectionMessageRoute;
  context: StoredProjectionMessageContext;
  occurredAt: Date;
  batchId: string;
  batchOrdinal: number;
  catalogGeneration: number;
  requiredConsumers: ReadonlyArray<DurableProjectionTarget>;
  mode: 'shadow' | 'active';
}>;

export type ProjectionMessageRef = Readonly<{
  eventId: string;
}>;

export interface ITransactionalProjectionMessageJournal {
  append(
    context: IExecutionContext,
    messages: ReadonlyArray<ProjectionMessageDraft>
  ): Promise<Result<ReadonlyArray<ProjectionMessageRef>, DomainError>>;
}
