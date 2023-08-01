/* eslint-disable sonarjs/no-duplicate-string */
import { ConsoleLogger } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { IFieldVo, IRecord, IViewVo } from '@teable-group/core';
import {
  CellValueType,
  DbFieldType,
  FieldType,
  generateRecordId,
  generateTableId,
  generateViewId,
  generateWorkflowActionId,
} from '@teable-group/core';
import { TeableConfigModule } from '../../../../../configs/config.module';
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
import type { ICreateRecordSchema } from './create-record';

jest.setTimeout(100000000);
describe('Create-Record Action Test', () => {
  let jsonRulesEngine: JsonRulesEngine;
  let tableOpenApiService: TableOpenApiService;
  let fieldService: FieldService;
  let recordOpenApiService: RecordOpenApiService;
  let tableId = generateTableId();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TeableConfigModule.register(),
        AutomationModule,
        TableOpenApiModule,
        RecordOpenApiModule,
        FieldModule,
        EventEmitterModule.forRoot(),
      ],
    }).compile();

    moduleRef.useLogger(new ConsoleLogger());

    jsonRulesEngine = await moduleRef.resolve<JsonRulesEngine>(JsonRulesEngine);
    tableOpenApiService = await moduleRef.resolve<TableOpenApiService>(TableOpenApiService);
    fieldService = await moduleRef.resolve<FieldService>(FieldService);
    recordOpenApiService = await moduleRef.resolve<RecordOpenApiService>(RecordOpenApiService);

    jest.spyOn(tableOpenApiService, 'createTable').mockImplementation((tableRo) =>
      Promise.resolve({
        name: 'table1-automation-add',
        id: tableId,
        order: 1,
        views: tableRo.views as IViewVo[],
        fields: tableRo.fields as IFieldVo[],
        records: tableRo.records as IRecord[],
        total: tableRo.records?.length || 3,
        lastModifiedTime: new Date().toISOString(),
      })
    );

    jest.spyOn(fieldService, 'getFields').mockImplementation((_tableId, _query) =>
      Promise.resolve([
        {
          id: 'fldHrMYez5yIwBdKEiK',
          name: 'name',
          type: FieldType.SingleLineText,
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          dbFieldName: 'name_fldHrMYez5yIwBdKEiK',
          isPrimary: true,
          isComputed: false,
          tableId: 'tblWhRzdMqzFegryaRS',
          columnMeta: {
            viw7zLgU4zVzbOK1HOe: {
              order: 0,
            },
          },
          options: {},
          version: 1,
          createdTime: '2023-05-31T11:23:57.045Z',
          lastModifiedTime: '2023-05-31T11:23:57.045Z',
          createdBy: 'admin',
          lastModifiedBy: 'admin',
        },
      ])
    );

    jest
      .spyOn(recordOpenApiService, 'multipleCreateRecords')
      .mockImplementation((_tableId, _createRecordsRo, _fieldName2IdMap) =>
        Promise.resolve({
          records: [
            {
              id: generateRecordId(),
              fields: {
                fldHrMYez5yIwBdKEiK: 'name: mockName',
              },
              recordOrder: { [generateViewId()]: 1 },
            },
          ],
          total: 1,
        })
      );

    tableId = await createTable();
  });

  const createTable = async (): Promise<string> => {
    const result = await tableOpenApiService.createTable({
      name: 'table1-automation-add',
      views: DEFAULT_VIEWS,
      fields: DEFAULT_FIELDS,
      records: DEFAULT_RECORD_DATA,
    });
    return result.id;
  };

  it('should call onSuccess and create records', async () => {
    const fields: IFieldVo[] = await fieldService.getFields(tableId, { viewId: undefined });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;

    const actionId = generateWorkflowActionId();
    jsonRulesEngine.addRule(actionId, ActionTypeEnums.CreateRecord, {
      inputSchema: {
        tableId: {
          type: 'const',
          value: tableId,
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
                    value: 'name: mockName',
                  },
                ],
              },
            },
          ],
        },
      } as ICreateRecordSchema,
    });

    const { results, almanac } = await jsonRulesEngine.fire();

    expect(results).toBeDefined();

    const [result] = results;

    expect(result.result).toBeTruthy();

    const createResult = await almanac.factValue(`action.${actionId}`);

    expect(createResult).toStrictEqual(expect.objectContaining({ status: 200 }));
    expect(createResult).toStrictEqual(
      expect.objectContaining({
        data: expect.objectContaining({ fields: { [firstTextField.id]: 'name: mockName' } }),
      })
    );
  });
});
