import { plainToInstance } from 'class-transformer';
import { DbFieldType, FieldType, CellValueType, Relationship } from '../field/constant';
import { FormulaFieldCore } from '../field/derivate/formula.field';
import { LinkFieldCore } from '../field/derivate/link.field';
import { RollupFieldCore } from '../field/derivate/rollup.field';
import { TableDomain } from './table-domain';

describe('TableDomain', () => {
  describe('getAllForeignTableIds', () => {
    it('should include dependent link fields when projecting computed fields', () => {
      const linkField = plainToInstance(LinkFieldCore, {
        id: 'fldlink',
        name: 'Link',
        type: FieldType.Link,
        dbFieldName: 'fldlink',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        isComputed: false,
        options: {
          foreignTableId: 'tblforeign',
          relationship: Relationship.OneMany,
          lookupFieldId: 'fldforeignLookup',
          fkHostTableName: 'tbl',
          selfKeyName: '__id',
          foreignKeyName: '__fk_fldlink',
        },
      });

      const rollupField = plainToInstance(RollupFieldCore, {
        id: 'fldrollup',
        name: 'Rollup',
        type: FieldType.Rollup,
        dbFieldName: 'fldrollup',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        isComputed: true,
        options: {
          expression: 'sum({values})',
        },
        isLookup: true,
        lookupOptions: {
          foreignTableId: 'tblforeign',
          lookupFieldId: 'fldforeignValue',
          linkFieldId: 'fldlink',
        },
      });

      const formulaField = plainToInstance(FormulaFieldCore, {
        id: 'fldformula',
        name: 'Formula',
        type: FieldType.Formula,
        dbFieldName: 'fldformula',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        isComputed: true,
        options: {
          expression: '{fldrollup}',
        },
      });

      const table = new TableDomain({
        id: 'tbl',
        name: 'Main',
        dbTableName: 'tbl_main',
        lastModifiedTime: new Date().toISOString(),
        fields: [linkField, rollupField, formulaField],
      });

      const foreignTableIds = table.getAllForeignTableIds(['fldformula']);

      expect(foreignTableIds.has('tblforeign')).toBe(true);
    });
  });
});
