import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../DomainError';
import type { SortDirection } from './SortDirection';

export interface ISortField<TSortKey> {
  key: TSortKey;
  direction: SortDirection;
}

export class Sort<TSortKey> {
  private constructor(private readonly fieldsValue: ReadonlyArray<ISortField<TSortKey>>) {}

  static create<TSortKey>(
    fields: ReadonlyArray<ISortField<TSortKey>>
  ): Result<Sort<TSortKey>, DomainError> {
    if (fields.length === 0) return err(domainError.validation({ message: 'Empty sort' }));
    return ok(new Sort(fields));
  }

  static empty<TSortKey>(): Sort<TSortKey> {
    return new Sort<TSortKey>([]);
  }

  fields(): ReadonlyArray<ISortField<TSortKey>> {
    return [...this.fieldsValue];
  }

  isEmpty(): boolean {
    return this.fieldsValue.length === 0;
  }
}
