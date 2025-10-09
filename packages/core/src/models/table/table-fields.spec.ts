/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType, Relationship } from '../field/constant';
import { LinkFieldCore } from '../field/derivate/link.field';
import { SingleLineTextFieldCore } from '../field/derivate/single-line-text.field';
import type { IFieldVo } from '../field/field.schema';
import { TableFields } from './table-fields';

describe('TableFields', () => {
  let fields: TableFields;

  const linkFieldJson: IFieldVo = {
    id: 'fldlink1',
    dbFieldName: 'fldlink1',
    name: 'Link Field 1',
    options: {
      relationship: Relationship.ManyOne,
      foreignTableId: 'tblforeign1',
      lookupFieldId: 'fldlookup1',
      fkHostTableName: 'dbTableName',
      selfKeyName: '__id',
      foreignKeyName: '__fk_fldlink1',
    },
    type: FieldType.Link,
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    isComputed: false,
  };

  const linkField2Json: IFieldVo = {
    id: 'fldlink2',
    dbFieldName: 'fldlink2',
    name: 'Link Field 2',
    options: {
      relationship: Relationship.OneMany,
      foreignTableId: 'tblforeign2',
      lookupFieldId: 'fldlookup2',
      fkHostTableName: 'dbTableName',
      selfKeyName: '__id',
      foreignKeyName: '__fk_fldlink2',
    },
    type: FieldType.Link,
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isMultipleCellValue: true,
    isComputed: false,
  };

  const lookupFieldJson: IFieldVo = {
    id: 'fldlookup',
    dbFieldName: 'fldlookup',
    name: 'Lookup Field',
    options: {
      relationship: Relationship.ManyOne,
      foreignTableId: 'tblforeign3',
      lookupFieldId: 'fldlookup3',
      fkHostTableName: 'dbTableName',
      selfKeyName: '__id',
      foreignKeyName: '__fk_fldlookup',
    },
    type: FieldType.Link,
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    isComputed: true,
    isLookup: true,
  };

  const textFieldJson: IFieldVo = {
    id: 'fldtext1',
    dbFieldName: 'fldtext1',
    name: 'Text Field',
    options: {},
    type: FieldType.SingleLineText,
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    isComputed: false,
  };

  const conditionalLookupFieldJson: IFieldVo = {
    id: 'fldconditionallookup',
    dbFieldName: 'fldconditionallookup',
    name: 'Conditional Lookup Field',
    options: {},
    type: FieldType.SingleLineText,
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    isMultipleCellValue: true,
    isComputed: true,
    isLookup: true,
    isConditionalLookup: true,
    lookupOptions: {
      foreignTableId: 'tblforeign4',
      lookupFieldId: 'fldlookup4',
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: 'fldtext1',
            operator: 'is',
            value: 'foo',
          },
        ],
      },
    },
  };

  beforeEach(() => {
    const linkField1 = plainToInstance(LinkFieldCore, linkFieldJson);
    const linkField2 = plainToInstance(LinkFieldCore, linkField2Json);
    const lookupField = plainToInstance(LinkFieldCore, lookupFieldJson);
    const textField = plainToInstance(SingleLineTextFieldCore, textFieldJson);
    const conditionalLookupField = plainToInstance(
      SingleLineTextFieldCore,
      conditionalLookupFieldJson
    );

    fields = new TableFields([
      linkField1,
      linkField2,
      lookupField,
      textField,
      conditionalLookupField,
    ]);
  });

  describe('getAllForeignTableIds', () => {
    it('should return foreign table IDs from link fields', () => {
      const relatedTableIds = fields.getAllForeignTableIds();

      expect(relatedTableIds).toBeInstanceOf(Set);
      expect(relatedTableIds.size).toBe(3);
      expect(relatedTableIds.has('tblforeign1')).toBe(true);
      expect(relatedTableIds.has('tblforeign2')).toBe(true);
      expect(relatedTableIds.has('tblforeign4')).toBe(true);
    });

    it('should exclude lookup fields', () => {
      const relatedTableIds = fields.getAllForeignTableIds();

      // Should not include the foreign table ID from lookup field
      expect(relatedTableIds.has('tblforeign3')).toBe(false);
    });

    it('should exclude non-link fields', () => {
      const relatedTableIds = fields.getAllForeignTableIds();

      // Should only include link field and conditional lookup foreign table IDs
      expect(relatedTableIds.size).toBe(3);
    });

    it('should return empty set when no link fields exist', () => {
      const textField = plainToInstance(SingleLineTextFieldCore, textFieldJson);
      const fieldsWithoutLinks = new TableFields([textField]);

      const relatedTableIds = fieldsWithoutLinks.getAllForeignTableIds();

      expect(relatedTableIds).toBeInstanceOf(Set);
      expect(relatedTableIds.size).toBe(0);
    });

    it('should return empty set when fields collection is empty', () => {
      const emptyFields = new TableFields([]);

      const relatedTableIds = emptyFields.getAllForeignTableIds();

      expect(relatedTableIds).toBeInstanceOf(Set);
      expect(relatedTableIds.size).toBe(0);
    });
  });
});
