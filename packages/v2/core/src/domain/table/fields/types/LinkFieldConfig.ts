import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../../../base/BaseId';
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
    fkHostTableName: z.string(),
    selfKeyName: z.string(),
    foreignKeyName: z.string(),
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
  fkHostTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
  symmetricFieldId?: string;
  filterByViewId?: string | null;
  visibleFieldIds?: ReadonlyArray<string> | null;
};

const optional = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, string>
): Result<T | undefined, string> => {
  if (raw == null) return ok(undefined);
  return parser(raw).map((value) => value);
};

const optionalNullable = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, string>
): Result<T | null | undefined, string> => {
  if (raw === null) return ok(null);
  if (raw === undefined) return ok(undefined);
  return parser(raw).map((value) => value);
};

const optionalNullableArray = <T>(
  raw: ReadonlyArray<string> | null | undefined,
  parser: (value: string) => Result<T, string>
): Result<ReadonlyArray<T> | null | undefined, string> => {
  if (raw === null) return ok(null);
  if (raw === undefined) return ok(undefined);
  const parsed = raw.map((value) => parser(value));
  return parsed.reduce<Result<ReadonlyArray<T>, string>>(
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

  static create(raw: unknown): Result<LinkFieldConfig, string> {
    const parsed = linkFieldConfigSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid LinkFieldConfig');
    const data = parsed.data;

    return optional(data.baseId, BaseId.create).andThen((baseId) =>
      LinkRelationship.create(data.relationship).andThen((relationship) =>
        TableId.create(data.foreignTableId).andThen((foreignTableId) =>
          FieldId.create(data.lookupFieldId).andThen((lookupFieldId) =>
            DbTableName.rehydrate(data.fkHostTableName).andThen((fkHostTableName) =>
              DbFieldName.rehydrate(data.selfKeyName).andThen((selfKeyName) =>
                DbFieldName.rehydrate(data.foreignKeyName).andThen((foreignKeyName) =>
                  optional(data.symmetricFieldId, FieldId.create).andThen((symmetricFieldId) =>
                    optionalNullable(data.filterByViewId, ViewId.create).andThen((filterByViewId) =>
                      optionalNullableArray(data.visibleFieldIds, FieldId.create).map(
                        (visibleFieldIds) =>
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
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    );
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

  fkHostTableNameString(): Result<string, string> {
    return this.fkHostTableNameValue.value();
  }

  selfKeyName(): DbFieldName {
    return this.selfKeyNameValue;
  }

  selfKeyNameString(): Result<string, string> {
    return this.selfKeyNameValue.value();
  }

  foreignKeyName(): DbFieldName {
    return this.foreignKeyNameValue;
  }

  foreignKeyNameString(): Result<string, string> {
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

  orderColumnName(): Result<string, string> {
    const relationship = this.relationshipValue.toString();
    if (relationship === 'manyMany') return ok('__order');
    if (relationship === 'oneMany') {
      return this.selfKeyNameString().map((name) => `${name}_order`);
    }
    return this.foreignKeyNameString().map((name) => `${name}_order`);
  }

  toDto(): Result<LinkFieldConfigValue, string> {
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
