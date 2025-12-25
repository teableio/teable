import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../../base/BaseId';
import type { DbTableName } from '../../DbTableName';
import type { ForeignTable } from '../../ForeignTable';
import type { TableId } from '../../TableId';
import type { ViewId } from '../../views/ViewId';
import type { DbFieldName } from '../DbFieldName';
import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { LinkFieldConfig, LinkFieldConfigValue } from './LinkFieldConfig';
import type { LinkFieldMeta, LinkFieldMetaValue } from './LinkFieldMeta';
import type { LinkRelationship } from './LinkRelationship';

export class LinkField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly configValue: LinkFieldConfig,
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

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitLinkField(this);
  }

  private ensureForeignTable(foreignTable: ForeignTable): Result<void, string> {
    if (!foreignTable.id().equals(this.foreignTableId())) {
      return err('ForeignTable does not match LinkField foreign table');
    }
    return ok(undefined);
  }
}
