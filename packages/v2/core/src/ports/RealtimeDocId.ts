import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { ValueObject } from '../domain/shared/ValueObject';

const realtimeDocIdSchema = z.string().min(1);
const realtimeDocIdSeparator = '/';

export type RealtimeDocIdParts = {
  collection: string;
  docId: string;
};

export class RealtimeDocId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<RealtimeDocId, DomainError> {
    const parsed = realtimeDocIdSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid RealtimeDocId' }));
    return ok(new RealtimeDocId(parsed.data));
  }

  static fromParts(collection: string, docId: string): Result<RealtimeDocId, DomainError> {
    return RealtimeDocId.create(`${collection}${realtimeDocIdSeparator}${docId}`);
  }

  static parse(raw: RealtimeDocId): Result<RealtimeDocIdParts, DomainError> {
    const value = raw.toString();
    const separatorIndex = value.indexOf(realtimeDocIdSeparator);
    if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
      return err(domainError.validation({ message: 'Invalid RealtimeDocId' }));
    }

    return ok({
      collection: value.slice(0, separatorIndex),
      docId: value.slice(separatorIndex + 1),
    });
  }

  equals(other: RealtimeDocId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
