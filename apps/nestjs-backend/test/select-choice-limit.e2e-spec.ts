/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  HttpError,
  IConvertFieldRo,
  IFieldRo,
  IFieldVo,
  ISelectFieldOptions,
  IUpdateFieldRo,
} from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import type { ICreateTableRo, ITableFullVo } from '@teable/openapi';
import {
  convertField as apiConvertField,
  createField as apiCreateField,
  paste,
  temporaryPaste,
  updateField as apiUpdateField,
} from '@teable/openapi';
import { getError } from './utils/get-error';
import {
  createBase,
  createSpace,
  createTable,
  getField,
  getFields,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
} from './utils/init-app';

// Neutral ASCII payloads keep the boundary readable: one name exactly at the
// limit and one over it, without customer identifiers or record data.
const MAX_CHOICE_NAME_LENGTH = 1000;
const PASTE_AT_LIMIT = 'a'.repeat(MAX_CHOICE_NAME_LENGTH);
const PASTE_OVER_LIMIT = 'b'.repeat(MAX_CHOICE_NAME_LENGTH + 1);
const CONVERT_AT_LIMIT = 'c'.repeat(MAX_CHOICE_NAME_LENGTH);
const CONVERT_OVER_LIMIT = 'd'.repeat(MAX_CHOICE_NAME_LENGTH + 1);
const EXPLICIT_OVER_LIMIT = 'e'.repeat(MAX_CHOICE_NAME_LENGTH + 1);

type ChoiceNameLimitData = {
  localization?: {
    i18nKey?: string;
    context?: Record<string, unknown>;
  };
};

const choicesOf = (field: IFieldVo) =>
  (field.options as ISelectFieldOptions | undefined)?.choices ?? [];

const choiceNamesOf = (field: IFieldVo) => choicesOf(field).map((choice) => choice.name);

const expectChoiceNameLimitError = (error: HttpError | undefined, oversizedName: string) => {
  expect(error?.status).toBe(400);

  const data = error?.data as ChoiceNameLimitData | undefined;
  expect(data?.localization).toMatchObject({
    i18nKey: 'httpErrors.limit.selectChoiceNameMaxLength',
    context: { max: MAX_CHOICE_NAME_LENGTH },
  });

  // The message stays readable and never echoes the rejected choice name.
  const message = error?.message ?? '';
  expect(message).toMatch(/choice|option/i);
  expect(message).not.toContain(oversizedName);
};

describe('Select choice name limit (T4291)', () => {
  let app: INestApplication;
  let spaceId: string;
  let baseId: string;
  const tableIds: string[] = [];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const space = await createSpace({ name: 'select choice limit space' });
    spaceId = space.id;
    const base = await createBase({ name: 'select choice limit base', spaceId });
    baseId = base.id;
  });

  afterEach(async () => {
    for (const tableId of tableIds.reverse()) {
      await permanentDeleteTable(baseId, tableId);
    }
    tableIds.length = 0;
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId);
    await permanentDeleteSpace(spaceId);
    await app.close();
  });

  const createLimitTable = async (name: string, tableVo: ICreateTableRo): Promise<ITableFullVo> => {
    const table = await createTable(baseId, { ...tableVo, name });
    tableIds.push(table.id);
    return table;
  };

  describe('temporary paste', () => {
    it.each([FieldType.SingleSelect, FieldType.MultipleSelect])(
      '%s keeps a choice at the limit without inserting records',
      async (fieldType) => {
        const table = await createLimitTable('paste at limit', {
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            { name: 'Choice', type: fieldType, options: { choices: [] } } as IFieldRo,
          ],
          records: [{ fields: {} }],
        });
        const choiceField = table.fields.find((field) => field.name === 'Choice') as IFieldVo;
        const recordsBefore = await getRecords(table.id);

        const response = await temporaryPaste(table.id, {
          viewId: table.views[0].id,
          ranges: [
            [1, 0],
            [1, 0],
          ],
          content: PASTE_AT_LIMIT,
        });

        expect(response.status).toBe(200);
        expect(choiceNamesOf(await getField(table.id, choiceField.id))).toContain(PASTE_AT_LIMIT);
        expect((await getRecords(table.id)).records).toHaveLength(recordsBefore.records.length);
      }
    );

    it.each([FieldType.SingleSelect, FieldType.MultipleSelect])(
      '%s rejects a choice over the limit and leaves the field choices unchanged',
      async (fieldType) => {
        const table = await createLimitTable('paste over limit', {
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            { name: 'Choice', type: fieldType, options: { choices: [] } } as IFieldRo,
          ],
          records: [{ fields: {} }],
        });
        const choiceField = table.fields.find((field) => field.name === 'Choice') as IFieldVo;
        const choicesBefore = choicesOf(await getField(table.id, choiceField.id));
        const recordsBefore = await getRecords(table.id);

        const error = await getError(() =>
          temporaryPaste(table.id, {
            viewId: table.views[0].id,
            ranges: [
              [1, 0],
              [1, 0],
            ],
            content: PASTE_OVER_LIMIT,
          })
        );

        expectChoiceNameLimitError(error, PASTE_OVER_LIMIT);
        expect(choicesOf(await getField(table.id, choiceField.id))).toEqual(choicesBefore);
        expect((await getRecords(table.id)).records).toHaveLength(recordsBefore.records.length);
      }
    );
  });

  it.each([FieldType.SingleSelect, FieldType.MultipleSelect])(
    'regular paste into %s rejects an oversized choice with the localized bound',
    async (fieldType) => {
      const table = await createLimitTable('regular paste over limit', {
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Choice', type: fieldType, options: { choices: [] } } as IFieldRo,
        ],
        records: [{ fields: {} }],
      });
      const choiceField = table.fields[1];
      const error = await getError(() =>
        paste(table.id, {
          viewId: table.views[0].id,
          ranges: [
            [1, 0],
            [1, 0],
          ],
          content: PASTE_OVER_LIMIT,
        })
      );

      expectChoiceNameLimitError(error, PASTE_OVER_LIMIT);
      expect(choicesOf(await getField(table.id, choiceField.id))).toEqual([]);
      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records).toHaveLength(1);
      expect(records[0].fields[choiceField.id]).toBeUndefined();
    }
  );

  describe('text conversion', () => {
    it.each([FieldType.SingleSelect, FieldType.MultipleSelect])(
      'converts a text value at the limit to %s',
      async (fieldType) => {
        const table = await createLimitTable('convert at limit', {
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            { name: 'Text', type: FieldType.SingleLineText },
          ],
          records: [{ fields: { Text: CONVERT_AT_LIMIT } }],
        });
        const textField = table.fields.find((field) => field.name === 'Text') as IFieldVo;

        const response = await apiConvertField(table.id, textField.id, {
          type: fieldType,
          options: { choices: [] },
        } as IConvertFieldRo);

        expect(response.status).toBe(200);
        const converted = await getField(table.id, textField.id);
        expect(converted.type).toBe(fieldType);
        expect(choiceNamesOf(converted)).toContain(CONVERT_AT_LIMIT);

        const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
        expect(records[0].fields[textField.id]).toEqual(
          fieldType === FieldType.MultipleSelect ? [CONVERT_AT_LIMIT] : CONVERT_AT_LIMIT
        );
      }
    );

    it.each([FieldType.SingleSelect, FieldType.MultipleSelect])(
      'rejects converting a text value over the limit to %s and keeps the source field',
      async (fieldType) => {
        const table = await createLimitTable('convert over limit', {
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            { name: 'Text', type: FieldType.SingleLineText },
          ],
          records: [{ fields: { Text: CONVERT_OVER_LIMIT } }],
        });
        const textField = table.fields.find((field) => field.name === 'Text') as IFieldVo;

        const error = await getError(() =>
          apiConvertField(table.id, textField.id, {
            type: fieldType,
            options: { choices: [] },
          } as IConvertFieldRo)
        );

        expectChoiceNameLimitError(error, CONVERT_OVER_LIMIT);

        const unchanged = await getField(table.id, textField.id);
        expect(unchanged.type).toBe(FieldType.SingleLineText);

        const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
        expect(records[0].fields[textField.id]).toBe(CONVERT_OVER_LIMIT);
      }
    );
  });

  describe('explicit field writes', () => {
    it('rejects creating a select field whose choice is over the limit', async () => {
      const table = await createLimitTable('explicit create', {
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        records: [],
      });

      const error = await getError(() =>
        apiCreateField(table.id, {
          name: 'Choice',
          type: FieldType.SingleSelect,
          options: { choices: [{ name: EXPLICIT_OVER_LIMIT }] },
        })
      );

      expectChoiceNameLimitError(error, EXPLICIT_OVER_LIMIT);
      expect((await getFields(table.id)).map((field) => field.name)).not.toContain('Choice');
    });

    it('rejects updating a select field to a choice over the limit', async () => {
      const table = await createLimitTable('explicit update', {
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Choice', type: FieldType.SingleSelect, options: { choices: [] } },
        ],
        records: [],
      });
      const choiceField = table.fields.find((field) => field.name === 'Choice') as IFieldVo;
      const choicesBefore = choicesOf(await getField(table.id, choiceField.id));

      const error = await getError(() =>
        apiUpdateField(table.id, choiceField.id, {
          options: { choices: [{ name: EXPLICIT_OVER_LIMIT }] },
        } as IUpdateFieldRo)
      );

      expectChoiceNameLimitError(error, EXPLICIT_OVER_LIMIT);
      expect(choicesOf(await getField(table.id, choiceField.id))).toEqual(choicesBefore);
    });
  });
});
