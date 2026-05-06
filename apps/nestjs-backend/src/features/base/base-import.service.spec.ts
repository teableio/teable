import { DbFieldType, FieldType } from '@teable/core';
import type { RestoreRecordInput } from '@teable/v2-core';

import { BaseImportService } from './base-import.service';

interface IRestoreRecordInputBuilder {
  toRestoreRecordInput(
    row: Record<string, string>,
    config: {
      dbTableName: string;
      columnNames: Set<string>;
      fieldsByDbFieldName: Map<
        string,
        {
          id: string;
          type: string;
          dbFieldName: string;
          dbFieldType: string;
          isMultipleCellValue: boolean | null;
          isComputed: boolean | null;
          notNull: boolean | null;
        }
      >;
    },
    viewIdMap: Record<string, string>
  ): RestoreRecordInput;
}

const dbTableName = 'bse_test.tbl_test';
const jsonColumnName = 'json_col';
const textColumnName = 'text_col';
const textCellValue = 'plain text';

const createService = () =>
  Object.create(BaseImportService.prototype) as IRestoreRecordInputBuilder;

describe('BaseImportService', () => {
  describe('toRestoreRecordInput', () => {
    it('serializes JSON extra column values for v2 dottea row restore', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName, textColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
          [
            textColumnName,
            {
              id: 'fldTextValue',
              type: FieldType.SingleLineText,
              dbFieldName: textColumnName,
              dbFieldType: DbFieldType.Text,
              isMultipleCellValue: false,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: '[{"id":"opt1","name":"A"}]',
          [textColumnName]: textCellValue,
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify([{ id: 'opt1', name: 'A' }]),
        [textColumnName]: textCellValue,
      });
    });

    it('wraps invalid legacy JSON cell strings before writing JSON columns', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: 'legacy text',
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify('legacy text'),
      });
    });

    it('serializes lower-case JSON db field types', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set([jsonColumnName]),
        fieldsByDbFieldName: new Map([
          [
            jsonColumnName,
            {
              id: 'fldJsonValue',
              type: FieldType.MultipleSelect,
              dbFieldName: jsonColumnName,
              dbFieldType: 'json',
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          [jsonColumnName]: '[{"id":"opt1","name":"A"}]',
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [jsonColumnName]: JSON.stringify([{ id: 'opt1', name: 'A' }]),
      });
    });

    it('skips computed field types even when legacy dottea lacks isComputed', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set(['formula_col', textColumnName]),
        fieldsByDbFieldName: new Map([
          [
            'formula_col',
            {
              id: 'fldFormulaValue',
              type: FieldType.Formula,
              dbFieldName: 'formula_col',
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: null,
              notNull: false,
            },
          ],
          [
            textColumnName,
            {
              id: 'fldTextValue',
              type: FieldType.SingleLineText,
              dbFieldName: textColumnName,
              dbFieldType: DbFieldType.Text,
              isMultipleCellValue: false,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          formula_col: '[1]',
          [textColumnName]: textCellValue,
        },
        config,
        {}
      );

      expect(record.extraColumnValues).toMatchObject({
        [textColumnName]: textCellValue,
      });
      expect(record.extraColumnValues).not.toHaveProperty('formula_col');
    });

    it('keeps attachment values on the typed field path', () => {
      const service = createService();
      const config = {
        dbTableName,
        columnNames: new Set(['attachment_col']),
        fieldsByDbFieldName: new Map([
          [
            'attachment_col',
            {
              id: 'fldAttachmentValue',
              type: FieldType.Attachment,
              dbFieldName: 'attachment_col',
              dbFieldType: DbFieldType.Json,
              isMultipleCellValue: true,
              isComputed: false,
              notNull: false,
            },
          ],
        ]),
      };

      const record = service.toRestoreRecordInput(
        {
          __id: 'recExistingRecord',
          attachment_col: '[{"id":"att1","name":"a.pdf"}]',
        },
        config,
        {}
      );

      expect(record.fields).toMatchObject({
        fldAttachmentValue: [{ id: 'att1', name: 'a.pdf' }],
      });
      expect(record.extraColumnValues).toBeUndefined();
    });
  });
});
