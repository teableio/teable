import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { Entity } from '../../shared/Entity';
import type { ViewColumnMeta } from './ViewColumnMeta';
import type { ViewId } from './ViewId';
import type { ViewName } from './ViewName';
import type { ViewQueryDefaults } from './ViewQueryDefaults';
import type { ViewType } from './ViewType';
import type { IViewVisitor } from './visitors/IViewVisitor';

export abstract class View extends Entity<ViewId> {
  private columnMetaValue: ViewColumnMeta | undefined;
  private queryDefaultsValue: ViewQueryDefaults | undefined;

  protected constructor(
    id: ViewId,
    private readonly nameValue: ViewName,
    private readonly typeValue: ViewType
  ) {
    super(id);
  }

  name(): ViewName {
    return this.nameValue;
  }

  type(): ViewType {
    return this.typeValue;
  }

  columnMeta(): Result<ViewColumnMeta, DomainError> {
    if (!this.columnMetaValue)
      return err(domainError.invariant({ message: 'ViewColumnMeta not set' }));
    return ok(this.columnMetaValue);
  }

  queryDefaults(): Result<ViewQueryDefaults, DomainError> {
    if (!this.queryDefaultsValue)
      return err(domainError.invariant({ message: 'ViewQueryDefaults not set' }));
    return ok(this.queryDefaultsValue);
  }

  setColumnMeta(columnMeta: ViewColumnMeta): Result<void, DomainError> {
    if (this.columnMetaValue) {
      if (this.columnMetaValue.equals(columnMeta)) return ok(undefined);
      return err(domainError.invariant({ message: 'ViewColumnMeta already set' }));
    }
    this.columnMetaValue = columnMeta;
    return ok(undefined);
  }

  setQueryDefaults(queryDefaults: ViewQueryDefaults): Result<void, DomainError> {
    if (this.queryDefaultsValue) {
      if (this.queryDefaultsValue.equals(queryDefaults)) return ok(undefined);
      return err(domainError.invariant({ message: 'ViewQueryDefaults already set' }));
    }
    this.queryDefaultsValue = queryDefaults;
    return ok(undefined);
  }

  abstract accept<T = void>(visitor: IViewVisitor<T>): Result<T, DomainError>;
}
