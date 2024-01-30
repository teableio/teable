/* eslint-disable sonarjs/no-duplicate-string */
import { faker } from '@faker-js/faker';
import { Test } from '@nestjs/testing';
import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import {
  CellValueType,
  DbFieldType,
  FieldType,
  generateBaseId,
  generateFieldId,
  generateRecordId,
  generateTableId,
  generateWorkflowActionId,
} from '@teable/core';
import { vi } from 'vitest';
import { GlobalModule } from '../../../../../global/global.module';
import { FieldModule } from '../../../../field/field.module';
import { FieldService } from '../../../../field/field.service';
import { RecordOpenApiModule } from '../../../../record/open-api/record-open-api.module';
import { RecordOpenApiService } from '../../../../record/open-api/record-open-api.service';
import { DEFAULT_FIELDS, DEFAULT_RECORD_DATA, DEFAULT_VIEWS } from '../../../../table/constant';
import { TableOpenApiModule } from '../../../../table/open-api/table-open-api.module';
import { TableOpenApiService } from '../../../../table/open-api/table-open-api.service';
import { AutomationModule } from '../../../automation.module';
import { JsonRulesEngine } from '../../../engine/json-rules-engine';
import { ActionTypeEnums } from '../../../enums/action-type.enum';
import type { IUpdateRecordSchema } from './update-record';

describe('Update-Record Action Test', () => {
  let jsonRulesEngine: JsonRulesEngine;
  let tableOpenApiService: TableOpenApiService;
  let fieldService: FieldService;
  let recordOpenApiService: RecordOpenApiService;
  const tableId = generateTableId();
  const recordId = generateRecordId();
  const fieldId = generateFieldId();
  const baseId = generateBaseId();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        GlobalModule,
        AutomationModule,
        TableOpenApiModule,
        RecordOpenApiModule,
        FieldModule,
      ],
    }).compile();

    jsonRulesEngine = await moduleRef.resolve<JsonRulesEngine>(JsonRulesEngine);
    tableOpenApiService = await moduleRef.resolve<TableOpenApiService>(TableOpenApiService);
    fieldService = await moduleRef.resolve<FieldService>(FieldService);
    recordOpenApiService = await moduleRef.resolve<RecordOpenApiService>(RecordOpenApiService);

    vi.spyOn(tableOpenApiService, 'createTable').mockImplementation((baseId, tableRo) =>
      Promise.resolve({
        name: `table1-${faker.string.nanoid()}`,
        dbTableName: `table1-${faker.string.nanoid()}`,
        id: tableId,
        order: faker.number.int(),
        views: tableRo.views as IViewVo[],
        fields: tableRo.fields as IFieldVo[],
        records: tableRo.records as IRecord[],
        total: 1,
        lastModifiedTime: new Date().toISOString(),
        defaultViewId: 'viwx',
      })
    );

    vi.spyOn(fieldService, 'getFieldsByQuery').mockImplementation((tableId, _query) =>
      Promise.resolve([
        {
          id: fieldId,
          name: faker.string.sample(),
          type: FieldType.SingleLineText,
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          dbFieldName: `name_${faker.string.nanoid()}`,
          isPrimary: true,
          isComputed: false,
          tableId: tableId,
          columnMeta: {
            viw7zLgU4zVzbOK1HOe: {
              order: 0,
            },
          },
          version: 1,
          options: {},
          createdTime: faker.date.soon().toString(),
          lastModifiedTime: faker.date.soon().toString(),
          createdBy: faker.string.nanoid(),
          lastModifiedBy: faker.string.nanoid(),
        },
      ])
    );

    vi.spyOn(recordOpenApiService, 'updateRecordById').mockImplementation(
      (tableId, recordId, _updateRecordRo) =>
        Promise.resolve({
          id: recordId,
          fields: { [fieldId]: 'update: mockName' },
          recordOrder: { tableId: 1 },
        })
    );

    await createTable();
  });

  const createTable = async (): Promise<string> => {
    const result = await tableOpenApiService.createTable(baseId, {
      name: 'table1-automation-add',
      views: DEFAULT_VIEWS,
      fields: DEFAULT_FIELDS as IFieldVo[],
      records: DEFAULT_RECORD_DATA,
    });
    return result.id;
  };

  it('should call onSuccess and update records', async () => {
    const fields: IFieldVo[] = await fieldService.getFieldsByQuery(tableId, { viewId: undefined });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;

    const actionId = generateWorkflowActionId();
    jsonRulesEngine.addRule(actionId, ActionTypeEnums.UpdateRecord, {
      inputSchema: {
        tableId: {
          type: 'const',
          value: tableId,
        },
        recordId: {
          type: 'template',
          elements: [
            {
              type: 'const',
              value: recordId,
            },
          ],
        },
        fields: {
          type: 'object',
          properties: [
            {
              key: {
                type: 'const',
                value: firstTextField.id,
              },
              value: {
                type: 'template',
                elements: [
                  {
                    type: 'const',
                    value: 'update: mockName',
                  },
                ],
              },
            },
          ],
        },
      } as IUpdateRecordSchema,
    });

    const { results, almanac } = await jsonRulesEngine.fire();

    expect(results).toBeDefined();

    const [result] = results;

    expect(result.result).toBeTruthy();

    const createResult = await almanac.factValue(`action.${actionId}`);

    expect(createResult).toStrictEqual(expect.objectContaining({ status: 200 }));
    expect(createResult).toStrictEqual(
      expect.objectContaining({
        data: expect.objectContaining({ fields: { [firstTextField.id]: 'update: mockName' } }),
      })
    );
  });
});
