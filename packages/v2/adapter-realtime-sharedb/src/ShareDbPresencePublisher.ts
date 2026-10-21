import { type DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';

/** Server-side presence signal publisher for ShareDB channels. */
export interface IShareDbPresencePublisher {
  publish(channel: string, data: unknown): Promise<Result<void, DomainError>>;
}
