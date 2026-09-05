import type { Result } from 'neverthrow';

import type { BaseId } from '../base/BaseId';
import type { DomainError } from '../shared/DomainError';
import type { ISpecification } from '../shared/specification/ISpecification';
import type { ISpecVisitor } from '../shared/specification/ISpecVisitor';
import type { DbTableName } from './DbTableName';
import type { Field } from './fields/Field';
import type { FieldId } from './fields/FieldId';
import type { TableId } from './TableId';
import type { TableName } from './TableName';
import type { View } from './views/View';
import type { ViewId } from './views/ViewId';

/**
 * Query-side view of {@link Table}. Record query plugins receive this, not the
 * aggregate: mutating methods (`addField`, `update`, `clone`, …) are not on
 * the contract. Do not cast back to {@link Table} (T7092).
 *
 * Compile-time only. Nested Field/View objects are still the live entities.
 */
export interface ITableReadModel {
  id(): TableId;
  baseId(): BaseId;
  name(): TableName;
  description(): string | undefined;
  icon(): string | undefined;
  dbTableName(): Result<DbTableName, DomainError>;
  primaryFieldId(): FieldId;
  primaryField(): Result<Field, DomainError>;
  getField<T extends Field>(predicate: (field: Field) => field is T): Result<T, DomainError>;
  getField(predicate: (field: Field) => boolean): Result<Field, DomainError>;
  getField(spec: ISpecification<Field, ISpecVisitor>): Result<Field, DomainError>;
  getFields<T extends Field>(predicate: (field: Field) => field is T): ReadonlyArray<T>;
  getFields(predicate: (field: Field) => boolean): ReadonlyArray<Field>;
  getFields(spec: ISpecification<Field, ISpecVisitor>): ReadonlyArray<Field>;
  getFields(): ReadonlyArray<Field>;
  views(): ReadonlyArray<View>;
  defaultView(): Result<View, DomainError>;
  getView(viewId: ViewId): Result<View, DomainError>;
  getViewById(viewIdStr: string): Result<View, DomainError>;
}
