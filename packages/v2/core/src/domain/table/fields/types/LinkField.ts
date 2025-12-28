import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../../base/BaseId';
import { DbTableName } from '../../DbTableName';
import type { ForeignTable } from '../../ForeignTable';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import type { ViewId } from '../../views/ViewId';
import type { DbFieldName } from '../DbFieldName';
import { Field } from '../Field';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import {
  LinkFieldConfig,
  type LinkFieldConfigValue,
  type LinkFieldDbConfig,
} from './LinkFieldConfig';
import type { LinkFieldMeta, LinkFieldMetaValue } from './LinkFieldMeta';
import type { LinkRelationship } from './LinkRelationship';

export class LinkField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private configValue: LinkFieldConfig,
    private readonly metaValue: LinkFieldMeta | undefined
  ) {
    super(id, name, FieldType.link());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    config: LinkFieldConfig;
    meta?: LinkFieldMeta;
  }): Result<LinkField, string> {
    return ok(new LinkField(params.id, params.name, params.config, params.meta));
  }

  static createNew(params: {
    id: FieldId;
    name: FieldName;
    config: LinkFieldConfig;
    baseId: BaseId;
    hostTableId: TableId;
    meta?: LinkFieldMeta;
  }): Result<LinkField, string> {
    return LinkField.create(params).andThen((field) =>
      field
        .ensureDbConfig({ baseId: params.baseId, hostTableId: params.hostTableId })
        .map(() => field)
    );
  }

  config(): LinkFieldConfig {
    return this.configValue;
  }

  configDto(): Result<LinkFieldConfigValue, string> {
    return this.configValue.toDto();
  }

  meta(): LinkFieldMeta | undefined {
    return this.metaValue;
  }

  metaDto(): LinkFieldMetaValue | undefined {
    return this.metaValue?.toDto();
  }

  baseId(): BaseId | undefined {
    return this.configValue.baseId();
  }

  relationship(): LinkRelationship {
    return this.configValue.relationship();
  }

  foreignTableId(): TableId {
    return this.configValue.foreignTableId();
  }

  lookupFieldId(): FieldId {
    return this.configValue.lookupFieldId();
  }

  symmetricFieldId(): FieldId | undefined {
    return this.configValue.symmetricFieldId();
  }

  isOneWay(): boolean {
    return this.configValue.isOneWay();
  }

  isMultipleValue(): boolean {
    return this.configValue.isMultipleValue();
  }

  fkHostTableName(): DbTableName {
    return this.configValue.fkHostTableName();
  }

  fkHostTableNameString(): Result<string, string> {
    return this.configValue.fkHostTableNameString();
  }

  selfKeyName(): DbFieldName {
    return this.configValue.selfKeyName();
  }

  selfKeyNameString(): Result<string, string> {
    return this.configValue.selfKeyNameString();
  }

  foreignKeyName(): DbFieldName {
    return this.configValue.foreignKeyName();
  }

  foreignKeyNameString(): Result<string, string> {
    return this.configValue.foreignKeyNameString();
  }

  filterByViewId(): ViewId | null | undefined {
    return this.configValue.filterByViewId();
  }

  visibleFieldIds(): ReadonlyArray<FieldId> | null | undefined {
    return this.configValue.visibleFieldIds();
  }

  isCrossBase(): boolean {
    return this.configValue.isCrossBase();
  }

  hasOrderColumn(): boolean {
    return this.metaValue?.hasOrderColumn() ?? false;
  }

  orderColumnName(): Result<string, string> {
    return this.configValue.orderColumnName();
  }

  lookupField(foreignTable: ForeignTable): Result<Field, string> {
    return this.ensureForeignTable(foreignTable).andThen(() =>
      foreignTable.fieldById(this.lookupFieldId())
    );
  }

  symmetricField(foreignTable: ForeignTable): Result<Field | undefined, string> {
    return this.ensureForeignTable(foreignTable).andThen(() => {
      const symmetricFieldId = this.symmetricFieldId();
      if (!symmetricFieldId) return ok(undefined);
      return foreignTable.fieldById(symmetricFieldId);
    });
  }

  visibleFields(
    foreignTable: ForeignTable
  ): Result<ReadonlyArray<Field> | null | undefined, string> {
    return this.ensureForeignTable(foreignTable).andThen(() => {
      const fieldIds = this.visibleFieldIds();
      if (fieldIds === null || fieldIds === undefined) return ok(fieldIds);
      return fieldIds.reduce<Result<ReadonlyArray<Field>, string>>(
        (acc, fieldId) =>
          acc.andThen((fields) =>
            foreignTable.fieldById(fieldId).map((field) => [...fields, field])
          ),
        ok([])
      );
    });
  }

  buildSymmetricField(params: {
    foreignTable: ForeignTable;
    hostTable: Table;
    symmetricFieldId?: FieldId;
  }): Result<LinkField, string> {
    const { foreignTable, hostTable } = params;
    if (this.isOneWay()) return err('One-way link has no symmetric field');

    const symmetricFieldIdResult = params.symmetricFieldId
      ? ok(params.symmetricFieldId)
      : this.symmetricFieldId()
        ? ok(this.symmetricFieldId()!)
        : FieldId.generate();

    const baseId = this.isCrossBase() ? hostTable.baseId().toString() : undefined;
    const lookupFieldId = hostTable.primaryFieldId().toString();

    const symmetricDbConfigResult: Result<LinkFieldDbConfig | undefined, string> =
      this.config().hasDbConfig()
        ? this.fkHostTableNameString().andThen((fkHostTableName) =>
            this.selfKeyNameString().andThen((selfKeyName) =>
              this.foreignKeyNameString().andThen((foreignKeyName) =>
                LinkFieldConfig.swapDbConfig({
                  fkHostTableName,
                  selfKeyName,
                  foreignKeyName,
                })
              )
            )
          )
        : ok<LinkFieldDbConfig | undefined, string>(undefined);

    return this.lookupField(foreignTable).andThen(() =>
      symmetricFieldIdResult.andThen((symmetricFieldId) =>
        symmetricDbConfigResult.andThen((symmetricDbConfig) =>
          this.setSymmetricFieldId(symmetricFieldId).andThen(() =>
            this.resolveSymmetricFieldName(hostTable, foreignTable).andThen((symmetricName) =>
              LinkFieldConfig.create({
                baseId,
                relationship: this.relationship().reverse().toString(),
                foreignTableId: hostTable.id().toString(),
                lookupFieldId,
                isOneWay: false,
                symmetricFieldId: this.id().toString(),
              }).andThen((config) =>
                (symmetricDbConfig ? config.withDbConfig(symmetricDbConfig) : ok(config)).andThen(
                  (finalConfig) =>
                    LinkField.create({
                      id: symmetricFieldId,
                      name: symmetricName,
                      config: finalConfig,
                      meta: this.meta(),
                    })
                )
              )
            )
          )
        )
      )
    );
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitLinkField(this);
  }

  setDbConfig(params: LinkFieldDbConfig): Result<void, string> {
    return this.configValue.withDbConfig(params).map((next) => {
      this.configValue = next;
      return undefined;
    });
  }

  setSymmetricFieldId(symmetricFieldId: FieldId): Result<void, string> {
    return this.configValue.withSymmetricFieldId(symmetricFieldId).map((next) => {
      this.configValue = next;
      return undefined;
    });
  }

  ensureDbConfig(params: { baseId: BaseId; hostTableId: TableId }): Result<void, string> {
    if (this.configValue.hasDbConfig()) return ok(undefined);

    const symmetricFieldIdResult = (() => {
      if (this.isOneWay()) return ok(this.symmetricFieldId());
      if (this.symmetricFieldId()) return ok(this.symmetricFieldId());
      return FieldId.generate().andThen((symmetricFieldId) =>
        this.setSymmetricFieldId(symmetricFieldId).map(() => symmetricFieldId)
      );
    })();

    if (symmetricFieldIdResult.isErr()) return err(symmetricFieldIdResult.error);
    const symmetricFieldId = symmetricFieldIdResult.value;

    return this.resolveFkHostTableName({
      baseId: params.baseId,
      hostTableId: params.hostTableId,
      symmetricFieldId,
    }).andThen((fkHostTableName) =>
      LinkFieldConfig.buildDbConfig({
        fkHostTableName,
        relationship: this.relationship(),
        fieldId: this.id(),
        symmetricFieldId,
        isOneWay: this.isOneWay(),
      }).andThen((dbConfig) => this.setDbConfig(dbConfig))
    );
  }

  private ensureForeignTable(foreignTable: ForeignTable): Result<void, string> {
    if (!foreignTable.id().equals(this.foreignTableId())) {
      return err('ForeignTable does not match LinkField foreign table');
    }
    return ok(undefined);
  }

  private resolveFkHostTableName = (params: {
    baseId: BaseId;
    hostTableId: TableId;
    symmetricFieldId?: FieldId;
  }): Result<DbTableName, string> => {
    const relationship = this.relationship().toString();
    if (relationship === 'manyMany') {
      return this.buildJunctionTableName(params.baseId, params.symmetricFieldId);
    }
    if (relationship === 'manyOne' || relationship === 'oneOne') {
      return DbTableName.rehydrate(`${params.baseId.toString()}.${params.hostTableId.toString()}`);
    }
    if (relationship === 'oneMany') {
      if (this.isOneWay()) {
        return this.buildJunctionTableName(params.baseId, params.symmetricFieldId);
      }
      return DbTableName.rehydrate(
        `${params.baseId.toString()}.${this.foreignTableId().toString()}`
      );
    }
    return err('Unsupported LinkRelationship');
  };

  private buildJunctionTableName(
    baseId: BaseId,
    symmetricFieldId?: FieldId
  ): Result<DbTableName, string> {
    const suffix = symmetricFieldId
      ? `${this.id().toString()}_${symmetricFieldId.toString()}`
      : this.id().toString();
    return DbTableName.rehydrate(`${baseId.toString()}.junction_${suffix}`);
  }

  private resolveSymmetricFieldName(
    hostTable: Table,
    foreignTable: ForeignTable
  ): Result<FieldName, string> {
    const baseNameResult = FieldName.create(hostTable.name().toString());
    if (baseNameResult.isErr()) return err(baseNameResult.error);
    return foreignTable.generateFieldName(baseNameResult.value);
  }
}
