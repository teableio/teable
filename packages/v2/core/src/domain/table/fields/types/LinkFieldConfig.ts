import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../../../base/BaseId';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { getRandomString } from '../../../shared/IdGenerator';
import { ValueObject } from '../../../shared/ValueObject';
import { DbTableName } from '../../DbTableName';
import { TableId } from '../../TableId';
import { ViewId } from '../../views/ViewId';
import { DbFieldName } from '../DbFieldName';
import { FieldId } from '../FieldId';
import { LinkRelationship, type LinkRelationshipValue } from './LinkRelationship';

const linkFieldConfigSchema = z
  .object({
    baseId: z.string().optional(),
    relationship: z.string(),
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    isOneWay: z.boolean().optional(),
    fkHostTableName: z.string().optional(),
    selfKeyName: z.string().optional(),
    foreignKeyName: z.string().optional(),
    symmetricFieldId: z.string().optional(),
    filterByViewId: z.string().nullable().optional(),
    visibleFieldIds: z.array(z.string()).nullable().optional(),
  })
  .strip();

export type LinkFieldConfigValue = {
  baseId?: string;
  relationship: LinkRelationshipValue;
  foreignTableId: string;
  lookupFieldId: string;
  isOneWay?: boolean;
  fkHostTableName?: string;
  selfKeyName?: string;
  foreignKeyName?: string;
  symmetricFieldId?: string;
  filterByViewId?: string | null;
  visibleFieldIds?: ReadonlyArray<string> | null;
};

export type LinkFieldDbConfig = {
  fkHostTableName: DbTableName;
  selfKeyName: DbFieldName;
  foreignKeyName: DbFieldName;
};

const optional = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, DomainError>
): Result<T | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  return parser(raw).map((value) => value);
};

const optionalNullable = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, DomainError>
): Result<T | null | undefined, DomainError> => {
  if (raw === null) return ok(null);
  if (raw === undefined) return ok(undefined);
  return parser(raw).map((value) => value);
};

const optionalNullableArray = <T>(
  raw: ReadonlyArray<string> | null | undefined,
  parser: (value: string) => Result<T, DomainError>
): Result<ReadonlyArray<T> | null | undefined, DomainError> => {
  if (raw === null) return ok(null);
  if (raw === undefined) return ok(undefined);
  const parsed = raw.map((value) => parser(value));
  return parsed.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
    ok([])
  );
};

export class LinkFieldConfig extends ValueObject {
  private constructor(
    private readonly baseIdValue: BaseId | undefined,
    private readonly relationshipValue: LinkRelationship,
    private readonly foreignTableIdValue: TableId,
    private readonly lookupFieldIdValue: FieldId,
    private readonly isOneWayValue: boolean,
    private readonly fkHostTableNameValue: DbTableName,
    private readonly selfKeyNameValue: DbFieldName,
    private readonly foreignKeyNameValue: DbFieldName,
    private readonly symmetricFieldIdValue: FieldId | undefined,
    private readonly filterByViewIdValue: ViewId | null | undefined,
    private readonly visibleFieldIdsValue: ReadonlyArray<FieldId> | null | undefined
  ) {
    super();
  }

  static create(raw: unknown): Result<LinkFieldConfig, DomainError> {
    const parsed = linkFieldConfigSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid LinkFieldConfig' }));
    const data = parsed.data;

    const fkHostTableNameResult: Result<DbTableName, DomainError> = data.fkHostTableName
      ? DbTableName.rehydrate(data.fkHostTableName)
      : ok<DbTableName, DomainError>(DbTableName.empty());
    const selfKeyNameResult: Result<DbFieldName, DomainError> = data.selfKeyName
      ? DbFieldName.rehydrate(data.selfKeyName)
      : ok<DbFieldName, DomainError>(DbFieldName.empty());
    const foreignKeyNameResult: Result<DbFieldName, DomainError> = data.foreignKeyName
      ? DbFieldName.rehydrate(data.foreignKeyName)
      : ok<DbFieldName, DomainError>(DbFieldName.empty());

    return safeTry<LinkFieldConfig, DomainError>(function* () {
      const baseId = yield* optional(data.baseId, BaseId.create);
      const relationship = yield* LinkRelationship.create(data.relationship);
      const foreignTableId = yield* TableId.create(data.foreignTableId);
      const lookupFieldId = yield* FieldId.create(data.lookupFieldId);
      const fkHostTableName = yield* fkHostTableNameResult;
      const selfKeyName = yield* selfKeyNameResult;
      const foreignKeyName = yield* foreignKeyNameResult;
      const symmetricFieldId = yield* optional(data.symmetricFieldId, FieldId.create);
      const filterByViewId = yield* optionalNullable(data.filterByViewId, ViewId.create);
      const visibleFieldIds = yield* optionalNullableArray(data.visibleFieldIds, FieldId.create);

      return ok(
        new LinkFieldConfig(
          baseId,
          relationship,
          foreignTableId,
          lookupFieldId,
          data.isOneWay ?? false,
          fkHostTableName,
          selfKeyName,
          foreignKeyName,
          symmetricFieldId,
          filterByViewId,
          visibleFieldIds
        )
      );
    });
  }

  static foreignKeyFieldName(fieldId?: FieldId): Result<DbFieldName, DomainError> {
    const name = fieldId ? `__fk_${fieldId.toString()}` : `__fk_rad${getRandomString(16)}`;
    return DbFieldName.rehydrate(name);
  }

  static swapDbConfig(raw: {
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
  }): Result<LinkFieldDbConfig, DomainError> {
    return DbTableName.rehydrate(raw.fkHostTableName).andThen((fkHostTableName) =>
      DbFieldName.rehydrate(raw.foreignKeyName).andThen((selfKeyName) =>
        DbFieldName.rehydrate(raw.selfKeyName).map((foreignKeyName) => ({
          fkHostTableName,
          selfKeyName,
          foreignKeyName,
        }))
      )
    );
  }

  static buildDbConfig(params: {
    fkHostTableName: DbTableName;
    relationship: LinkRelationship;
    fieldId: FieldId;
    symmetricFieldId?: FieldId;
    isOneWay: boolean;
  }): Result<LinkFieldDbConfig, DomainError> {
    const relationship = params.relationship.toString();

    if (relationship === 'manyMany') {
      return LinkFieldConfig.foreignKeyFieldName(params.symmetricFieldId).andThen((selfKeyName) =>
        LinkFieldConfig.foreignKeyFieldName(params.fieldId).map((foreignKeyName) => ({
          fkHostTableName: params.fkHostTableName,
          selfKeyName,
          foreignKeyName,
        }))
      );
    }

    if (relationship === 'manyOne' || relationship === 'oneOne') {
      return DbFieldName.rehydrate('__id').andThen((selfKeyName) =>
        LinkFieldConfig.foreignKeyFieldName(params.fieldId).map((foreignKeyName) => ({
          fkHostTableName: params.fkHostTableName,
          selfKeyName,
          foreignKeyName,
        }))
      );
    }

    if (relationship === 'oneMany') {
      if (params.isOneWay) {
        return LinkFieldConfig.foreignKeyFieldName(params.symmetricFieldId).andThen((selfKeyName) =>
          LinkFieldConfig.foreignKeyFieldName(params.fieldId).map((foreignKeyName) => ({
            fkHostTableName: params.fkHostTableName,
            selfKeyName,
            foreignKeyName,
          }))
        );
      }

      return LinkFieldConfig.foreignKeyFieldName(params.symmetricFieldId).andThen((selfKeyName) =>
        DbFieldName.rehydrate('__id').map((foreignKeyName) => ({
          fkHostTableName: params.fkHostTableName,
          selfKeyName,
          foreignKeyName,
        }))
      );
    }

    return err(domainError.validation({ message: 'Unsupported LinkRelationship' }));
  }

  equals(other: LinkFieldConfig): boolean {
    return (
      this.equalOptional(this.baseIdValue, other.baseIdValue) &&
      this.relationshipValue.equals(other.relationshipValue) &&
      this.foreignTableIdValue.equals(other.foreignTableIdValue) &&
      this.lookupFieldIdValue.equals(other.lookupFieldIdValue) &&
      this.isOneWayValue === other.isOneWayValue &&
      this.fkHostTableNameValue.equals(other.fkHostTableNameValue) &&
      this.selfKeyNameValue.equals(other.selfKeyNameValue) &&
      this.foreignKeyNameValue.equals(other.foreignKeyNameValue) &&
      this.equalOptional(this.symmetricFieldIdValue, other.symmetricFieldIdValue) &&
      this.equalNullable(this.filterByViewIdValue, other.filterByViewIdValue) &&
      this.equalNullableArray(this.visibleFieldIdsValue, other.visibleFieldIdsValue)
    );
  }

  baseId(): BaseId | undefined {
    return this.baseIdValue;
  }

  relationship(): LinkRelationship {
    return this.relationshipValue;
  }

  foreignTableId(): TableId {
    return this.foreignTableIdValue;
  }

  lookupFieldId(): FieldId {
    return this.lookupFieldIdValue;
  }

  isOneWay(): boolean {
    return this.isOneWayValue;
  }

  isMultipleValue(): boolean {
    return this.relationshipValue.isMultipleValue();
  }

  fkHostTableName(): DbTableName {
    return this.fkHostTableNameValue;
  }

  fkHostTableNameString(): Result<string, DomainError> {
    return this.fkHostTableNameValue.value();
  }

  selfKeyName(): DbFieldName {
    return this.selfKeyNameValue;
  }

  selfKeyNameString(): Result<string, DomainError> {
    return this.selfKeyNameValue.value();
  }

  foreignKeyName(): DbFieldName {
    return this.foreignKeyNameValue;
  }

  foreignKeyNameString(): Result<string, DomainError> {
    return this.foreignKeyNameValue.value();
  }

  symmetricFieldId(): FieldId | undefined {
    return this.symmetricFieldIdValue;
  }

  filterByViewId(): ViewId | null | undefined {
    return this.filterByViewIdValue;
  }

  visibleFieldIds(): ReadonlyArray<FieldId> | null | undefined {
    if (this.visibleFieldIdsValue === null || this.visibleFieldIdsValue === undefined) {
      return this.visibleFieldIdsValue;
    }
    return [...this.visibleFieldIdsValue];
  }

  isCrossBase(): boolean {
    return !!this.baseIdValue;
  }

  hasDbConfig(): boolean {
    return (
      this.fkHostTableNameValue.isRehydrated() &&
      this.selfKeyNameValue.isRehydrated() &&
      this.foreignKeyNameValue.isRehydrated()
    );
  }

  withDbConfig(params: LinkFieldDbConfig): Result<LinkFieldConfig, DomainError> {
    if (this.fkHostTableNameValue.isRehydrated()) {
      if (!this.fkHostTableNameValue.equals(params.fkHostTableName)) {
        return err(
          domainError.invariant({ message: 'LinkFieldConfig fkHostTableName already set' })
        );
      }
    }
    if (this.selfKeyNameValue.isRehydrated()) {
      if (!this.selfKeyNameValue.equals(params.selfKeyName)) {
        return err(domainError.invariant({ message: 'LinkFieldConfig selfKeyName already set' }));
      }
    }
    if (this.foreignKeyNameValue.isRehydrated()) {
      if (!this.foreignKeyNameValue.equals(params.foreignKeyName)) {
        return err(
          domainError.invariant({ message: 'LinkFieldConfig foreignKeyName already set' })
        );
      }
    }

    return ok(
      new LinkFieldConfig(
        this.baseIdValue,
        this.relationshipValue,
        this.foreignTableIdValue,
        this.lookupFieldIdValue,
        this.isOneWayValue,
        params.fkHostTableName,
        params.selfKeyName,
        params.foreignKeyName,
        this.symmetricFieldIdValue,
        this.filterByViewIdValue,
        this.visibleFieldIdsValue
      )
    );
  }

  withSymmetricFieldId(symmetricFieldId: FieldId): Result<LinkFieldConfig, DomainError> {
    if (this.symmetricFieldIdValue) {
      if (!this.symmetricFieldIdValue.equals(symmetricFieldId)) {
        return err(
          domainError.invariant({ message: 'LinkFieldConfig symmetricFieldId already set' })
        );
      }
      return ok(this);
    }

    return ok(
      new LinkFieldConfig(
        this.baseIdValue,
        this.relationshipValue,
        this.foreignTableIdValue,
        this.lookupFieldIdValue,
        this.isOneWayValue,
        this.fkHostTableNameValue,
        this.selfKeyNameValue,
        this.foreignKeyNameValue,
        symmetricFieldId,
        this.filterByViewIdValue,
        this.visibleFieldIdsValue
      )
    );
  }

  orderColumnName(): Result<string, DomainError> {
    const relationship = this.relationshipValue.toString();
    if (relationship === 'manyMany') return ok('__order');
    if (relationship === 'oneMany') {
      return this.selfKeyNameString().map((name) => `${name}_order`);
    }
    return this.foreignKeyNameString().map((name) => `${name}_order`);
  }

  toDto(): Result<LinkFieldConfigValue, DomainError> {
    return this.fkHostTableNameString().andThen((fkHostTableName) =>
      this.selfKeyNameString().andThen((selfKeyName) =>
        this.foreignKeyNameString().map((foreignKeyName) => ({
          baseId: this.baseIdValue?.toString(),
          relationship: this.relationshipValue.toString(),
          foreignTableId: this.foreignTableIdValue.toString(),
          lookupFieldId: this.lookupFieldIdValue.toString(),
          isOneWay: this.isOneWayValue,
          fkHostTableName,
          selfKeyName,
          foreignKeyName,
          symmetricFieldId: this.symmetricFieldIdValue?.toString(),
          filterByViewId:
            this.filterByViewIdValue === null ? null : this.filterByViewIdValue?.toString(),
          visibleFieldIds:
            this.visibleFieldIdsValue === null
              ? null
              : this.visibleFieldIdsValue?.map((id) => id.toString()),
        }))
      )
    );
  }

  private equalOptional<T extends ValueObject>(left: T | undefined, right: T | undefined): boolean {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return left.equals(right);
  }

  private equalNullable<T extends ValueObject>(
    left: T | null | undefined,
    right: T | null | undefined
  ): boolean {
    if (left === null && right === null) return true;
    if (left === undefined && right === undefined) return true;
    if (left == null || right == null) return false;
    return left.equals(right);
  }

  private equalNullableArray<T extends ValueObject>(
    left: ReadonlyArray<T> | null | undefined,
    right: ReadonlyArray<T> | null | undefined
  ): boolean {
    if (left === null && right === null) return true;
    if (left === undefined && right === undefined) return true;
    if (!left || !right) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) => value.equals(right[index]!));
  }
}
