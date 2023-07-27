/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IFieldVo, IRecord } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { CopyAndPasteSchema } from '@teable-group/openapi';
import { noop } from 'lodash';
import { PrismaService } from '../../prisma.service';
import { TransactionService } from '../../share-db/transaction.service';
import { FieldService } from '../field/field.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRo } from '../field/model/factory';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';
import { CopyPasteModule } from './copy-paste.module';
import { CopyPasteService } from './copy-paste.service';

describe('CopyPasteService', () => {
  let copyPasteService: CopyPasteService;
  let recordService: RecordService;
  let fieldService: FieldService;
  let prismaService: PrismaService;
  let recordOpenApiService: RecordOpenApiService;
  let fieldOpenApiService: FieldOpenApiService;
  let transactionService: TransactionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [CopyPasteModule, EventEmitterModule.forRoot()],
    })
      .overrideProvider(PrismaService)
      .useValue({
        attachments: {
          findMany: jest.fn(),
        },
      })
      .compile();

    copyPasteService = module.get<CopyPasteService>(CopyPasteService);
    fieldService = module.get<FieldService>(FieldService);
    recordService = module.get<RecordService>(RecordService);
    prismaService = module.get<PrismaService>(PrismaService);
    recordOpenApiService = module.get<RecordOpenApiService>(RecordOpenApiService);
    fieldOpenApiService = module.get<FieldOpenApiService>(FieldOpenApiService);
    transactionService = module.get<TransactionService>(TransactionService);
  });

  describe('getRangeTableContent', () => {
    it('should return range table content', async () => {
      const tableId = 'table1';
      const viewId = 'view1';
      const range = [
        [0, 0],
        [1, 1],
      ];
      const expectedFields = [
        {
          id: 'field1',
          type: FieldType.SingleLineText,
        },
        {
          id: 'field2',
          type: FieldType.SingleLineText,
        },
      ];
      const expectedRecords = {
        records: [
          {
            id: '',
            recordOrder: { [viewId]: 1 },
            fields: { field1: 'value1', field2: 'value2' },
          },
          {
            id: '',
            recordOrder: { [viewId]: 2 },
            fields: { field1: 'value3', field2: 'value4' },
          },
        ],
        total: 2,
      };
      const expectedTableContent = [
        ['value1', 'value2'],
        ['value3', 'value4'],
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(fieldService, 'getFields').mockResolvedValue(expectedFields as any);
      jest.spyOn(recordService, 'getRecords').mockResolvedValue(expectedRecords);

      const result = await copyPasteService['getRangeTableContent'](tableId, viewId, range);

      expect(fieldService.getFields).toHaveBeenCalledWith(tableId, { viewId });
      expect(recordService.getRecords).toHaveBeenCalledWith(tableId, {
        fieldKeyType: 'id',
        viewId,
        skip: 0,
        take: 2,
      });
      expect(result).toEqual(expectedTableContent);
    });
  });

  describe('mergeRangesData', () => {
    it('should merge ranges data for column type', () => {
      const rangesData = [
        [['a'], ['b']],
        [['c'], ['d']],
      ];
      const type = CopyAndPasteSchema.RangeType.Column;
      const expectedMergedData = [
        ['a', 'c'],
        ['b', 'd'],
      ];

      const result = copyPasteService['mergeRangesData'](rangesData, type);

      expect(result).toEqual(expectedMergedData);
    });

    it('should merge ranges data for row type', () => {
      const rangesData = [
        [['a'], ['b']],
        [['c'], ['d']],
      ];
      const type = CopyAndPasteSchema.RangeType.Row;
      const expectedMergedData = [['a'], ['b'], ['c'], ['d']];

      const result = copyPasteService['mergeRangesData'](rangesData, type);

      expect(result).toEqual(expectedMergedData);
    });
  });

  describe('getCopyHeader', () => {
    const tableId = 'table1';
    const viewId = 'view1';

    it('should return the header fields for given ranges', async () => {
      const mockFields = [
        { id: '3', name: 'Email', type: FieldType.SingleLineText },
        { id: '4', name: 'Phone', type: FieldType.SingleLineText },
      ] as IFieldVo[];
      const ranges: number[][] = [
        [0, 1],
        [0, 2],
      ];

      jest.spyOn(fieldService, 'getFields').mockResolvedValue(mockFields);
      const headerFields = await copyPasteService['getCopyHeader'](tableId, viewId, ranges);
      expect(headerFields).toEqual([mockFields[0]]);
    });
  });

  describe('copy', () => {
    const tableId = 'table1';
    const viewId = 'view1';
    const range = '[[0, 0], [1, 1]]';

    it('should return merged ranges data', async () => {
      const expectedMergedData = [
        ['value1', 'value2'],
        ['value3', 'value4'],
      ];

      jest.spyOn(JSON, 'parse').mockReturnValue([
        [0, 0],
        [1, 1],
      ]);
      jest.spyOn(copyPasteService as any, 'getRangeTableContent').mockResolvedValue([
        ['value1', 'value2'],
        ['value3', 'value4'],
      ]);
      jest.spyOn(copyPasteService as any, 'mergeRangesData').mockReturnValue(expectedMergedData);
      jest.spyOn(copyPasteService as any, 'getCopyHeader').mockReturnValue([]);

      const result = await copyPasteService.copy(tableId, viewId, {
        ranges: range,
        type: CopyAndPasteSchema.RangeType.Row,
      });

      expect(JSON.parse).toHaveBeenCalledWith(range);
      expect(copyPasteService['getRangeTableContent']).toHaveBeenCalledWith(tableId, viewId, [
        [0, 0],
        [1, 1],
      ]);
      expect(copyPasteService['mergeRangesData']).toHaveBeenCalledWith(
        [
          [
            ['value1', 'value2'],
            ['value3', 'value4'],
          ],
        ],
        CopyAndPasteSchema.RangeType.Row
      );
      expect(result?.content).toEqual('value1\tvalue2\nvalue3\tvalue4');
    });

    it('should return empty array when ranges array is empty', async () => {
      jest.spyOn(JSON, 'parse').mockReturnValue([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(copyPasteService as any, 'getRangeTableContent');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(copyPasteService as any, 'mergeRangesData');
      jest.spyOn(copyPasteService as any, 'getCopyHeader').mockReturnValue([]);

      const result = await copyPasteService.copy(tableId, viewId, {
        ranges: range,
        type: CopyAndPasteSchema.RangeType.Row,
      });

      expect(JSON.parse).toHaveBeenCalledWith(range);
      expect(copyPasteService['getRangeTableContent']).not.toHaveBeenCalled();
      expect(copyPasteService['mergeRangesData']).not.toHaveBeenCalled();
      expect(result?.content).toEqual(undefined);
    });
  });

  describe('parseCopyContent', () => {
    it('should parse the copy content into a 2D array', () => {
      // Input
      const content = 'John\tDoe\tjohn.doe@example.com\nJane\tSmith\tjane.smith@example.com';
      const expectedParsedContent = [
        ['John', 'Doe', 'john.doe@example.com'],
        ['Jane', 'Smith', 'jane.smith@example.com'],
      ];

      // Perform the parsing
      const result = copyPasteService['parseCopyContent'](content);

      // Verify the result
      expect(result).toEqual(expectedParsedContent);
    });
  });

  describe('calculateExpansion', () => {
    it('should calculate the number of rows and columns to expand', () => {
      // Input
      const tableSize: [number, number] = [5, 4];
      const cell: [number, number] = [2, 3];
      const content = [
        ['John', 'Doe'],
        ['Jane', 'Smith'],
      ];
      const expectedExpansion = [0, 1];

      // Perform the calculation
      const result = copyPasteService['calculateExpansion'](tableSize, cell, content);

      // Verify the result
      expect(result).toEqual(expectedExpansion);
    });
  });

  describe('expandRows', () => {
    it('should expand the rows and create new records', async () => {
      // Mock dependencies
      const tableId = 'table1';
      const numRowsToExpand = 3;
      const transactionKey = 'transactionKey';
      const expectedRecords = [
        { id: 'record1', fields: {} },
        { id: 'record2', fields: {} },
      ] as IRecord[];
      jest.spyOn(recordOpenApiService, 'multipleCreateRecords').mockResolvedValueOnce({
        records: expectedRecords,
      });

      // Perform expanding rows
      const result = await copyPasteService['expandRows']({
        tableId,
        numRowsToExpand,
        transactionKey,
      });

      // Verify the multipleCreateRecords call
      expect(recordOpenApiService.multipleCreateRecords).toHaveBeenCalledTimes(1);
      expect(recordOpenApiService.multipleCreateRecords).toHaveBeenCalledWith(
        tableId,
        { records: Array.from({ length: numRowsToExpand }, () => ({ fields: {} })) },
        transactionKey
      );

      // Verify the result
      expect(result).toEqual({ records: expectedRecords });
    });
  });

  describe('expandColumns', () => {
    it('should expand the columns and create new fields', async () => {
      // Mock dependencies
      const tableId = 'table1';
      const viewId = 'view1';
      const header = [
        { id: '3', name: 'Email', type: FieldType.SingleLineText },
        { id: '4', name: 'Phone', type: FieldType.SingleLineText },
      ] as IFieldVo[];
      const numColsToExpand = 2;
      const transactionKey = 'transactionKey';
      jest.spyOn(fieldOpenApiService, 'createField').mockResolvedValueOnce(header[0]);
      jest.spyOn(fieldOpenApiService, 'createField').mockResolvedValueOnce(header[1]);

      // Perform expanding columns
      const result = await copyPasteService['expandColumns']({
        tableId,
        viewId,
        header,
        numColsToExpand,
        transactionKey,
      });

      // Verify the createField calls
      expect(fieldOpenApiService.createField).toHaveBeenCalledTimes(2);

      // Verify the result
      expect(result.length).toEqual(2);
    });
  });

  describe('collectionAttachment', () => {
    it('should return attachments based on tokens', async () => {
      const fields: IFieldInstance[] = [
        createFieldInstanceByRo({ id: '1', name: 'attachments', type: FieldType.Attachment }),
      ];
      const tableData: string[][] = [
        ['file1.png (https://xxx.xxx/token1),file2.png (https://xxx.xxx/token2)'],
        ['file3.png (https://xxx.xxx/token3)'],
      ];
      const startColumn = 0;

      const mockAttachment = [
        {
          token: 'token1',
          path: '',
          url: '',
          size: 1,
          mimetype: 'image/png',
          width: 10,
          height: 10,
        },
        {
          token: 'token2',
          path: '',
          url: '',
          size: 1,
          mimetype: 'image/png',
          width: 10,
          height: 10,
        },
        {
          token: 'token3',
          path: '',
          url: '',
          size: 1,
          mimetype: 'image/png',
          width: 10,
          height: 10,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // jest.spyOn(prismaService.attachments, 'findMany').mockImplementation(() => {
      //   return Promise.resolve([]) as any;
      // });
      // (prismaService.attachments.findMany as jest.Mock).mockResolvedValue(mockAttachment);

      (prismaService.attachments.findMany as jest.Mock).mockResolvedValue(mockAttachment);
      const result = await copyPasteService['collectionAttachment']({
        tableData,
        fields,
        startColumn,
      });

      expect(prismaService.attachments.findMany).toHaveBeenCalledWith({
        where: {
          token: {
            in: ['token1', 'token2', 'token3'],
          },
        },
        select: {
          token: true,
          size: true,
          mimetype: true,
          width: true,
          height: true,
          path: true,
          url: true,
        },
      });
      // Assert the result based on the mocked attachments
      expect(result).toEqual(mockAttachment);
    });
  });

  describe('fillCells', () => {
    it('should fill the cells with provided table data', async () => {
      // Mock data
      const tableId = 'testTableId';
      const cell: [number, number] = [0, 1];
      const tableData = [
        ['A1', 'B1', 'C1'],
        ['A2', 'B2', 'C2'],
        ['A3', 'B3', 'C3'],
      ];

      const fields = [
        { id: 'field1', name: 'Field 1', type: FieldType.SingleLineText },
        { id: 'field2', name: 'Field 2', type: FieldType.SingleLineText },
        { id: 'field3', name: 'Field 3', type: FieldType.SingleLineText },
      ].map(createFieldInstanceByRo);

      const records = [
        { id: 'record1', recordOrder: {}, fields: {} },
        { id: 'record2', recordOrder: {}, fields: {} },
        { id: 'record3', recordOrder: {}, fields: {} },
      ];
      const transactionKey = 'testTransactionKey';

      // Mock service methods
      const updateRecordByIdSpy = jest
        .spyOn(recordOpenApiService, 'updateRecordById')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue(null as any);

      // Execute the method
      await copyPasteService['fillCells']({
        cell,
        tableData,
        tableId,
        fields,
        records,
        transactionKey,
      });

      // Verify the service method calls
      expect(updateRecordByIdSpy).toHaveBeenCalledTimes(tableData.length);
      expect(updateRecordByIdSpy).toHaveBeenCalledWith(
        tableId,
        records[0].id,
        { record: { fields: { field1: 'A1', field2: 'B1', field3: 'C1' } } },
        transactionKey
      );
      expect(updateRecordByIdSpy).toHaveBeenCalledWith(
        tableId,
        records[1].id,
        { record: { fields: { field1: 'A2', field2: 'B2', field3: 'C2' } } },
        transactionKey
      );
      expect(updateRecordByIdSpy).toHaveBeenCalledWith(
        tableId,
        records[2].id,
        { record: { fields: { field1: 'A3', field2: 'B3', field3: 'C3' } } },
        transactionKey
      );
    });
  });

  describe('paste', () => {
    const content = 'A1\tB1\tC1\nA2\tB2\tC2\nA3\tB3\tC3';
    const tableData = [
      ['A1', 'B1', 'C1'],
      ['A2', 'B2', 'C2'],
      ['A3', 'B3', 'C3'],
    ];
    const testTransactionKey = 'testTransactionKey';

    it('should paste table data and update records', async () => {
      // Mock input parameters
      const tableId = 'testTableId';
      const viewId = 'testViewId';

      // Mock dependencies
      const mockFields = [
        { id: 'fieldId1', name: 'Field 1', type: FieldType.SingleLineText },
        { id: 'fieldId2', name: 'Field 2', type: FieldType.SingleLineText },
        { id: 'fieldId3', name: 'Field 3', type: FieldType.SingleLineText },
      ].map(createFieldInstanceByRo);

      const pasteRo = {
        cell: [2, 1] as [number, number],
        content,
        header: mockFields,
      };

      const mockRecords = [
        { id: 'recordId1', recordOrder: {}, fields: {} },
        { id: 'recordId2', recordOrder: {}, fields: {} },
      ];

      const mockNewFields = [
        { id: 'newFieldId1', name: 'Field 1', type: FieldType.SingleLineText },
        { id: 'newFieldId2', name: 'Field 2', type: FieldType.SingleLineText },
      ].map(createFieldInstanceByRo);

      const mockNewRecords = [
        { id: 'newRecordId1', recordOrder: {}, fields: {} },
        { id: 'newRecordId2', recordOrder: {}, fields: {} },
      ];

      jest.spyOn(copyPasteService as any, 'parseCopyContent').mockReturnValue(tableData);

      jest.spyOn(recordService, 'getRowCount').mockResolvedValue(mockRecords.length);
      jest.spyOn(recordService, 'getRecords').mockResolvedValue({
        records: mockRecords.slice(pasteRo.cell[1]),
        total: mockRecords.length,
      });

      jest.spyOn(fieldService, 'getFieldInstances').mockResolvedValue(mockFields);

      jest.spyOn(copyPasteService as any, 'expandRows').mockResolvedValue({
        records: mockNewRecords,
      });
      jest.spyOn(copyPasteService as any, 'expandColumns').mockResolvedValue(mockNewFields);
      jest.spyOn(copyPasteService as any, 'fillCells').mockImplementation(noop);
      jest.spyOn(transactionService, '$transaction').mockImplementation(async (_, callback) => {
        await callback(prismaService, testTransactionKey);
      });

      // Call the method
      const result = await copyPasteService.paste(tableId, viewId, pasteRo);

      // Assertions
      expect(copyPasteService['parseCopyContent']).toHaveBeenCalledWith(content);
      expect(recordService.getRowCount).toHaveBeenCalledWith(prismaService, tableId, viewId);
      expect(recordService.getRecords).toHaveBeenCalledWith(tableId, {
        viewId,
        skip: 1,
        take: tableData.length,
        fieldKeyType: 'id',
      });

      expect(fieldService.getFieldInstances).toHaveBeenCalledWith(tableId, { viewId });

      expect(copyPasteService['expandColumns']).toHaveBeenCalledWith({
        tableId,
        viewId,
        header: mockFields,
        numColsToExpand: 2,
        transactionKey: testTransactionKey,
      });

      expect(copyPasteService['expandRows']).toHaveBeenCalledWith({
        tableId,
        numRowsToExpand: 2,
        transactionKey: testTransactionKey,
      });

      expect(copyPasteService['fillCells']).toHaveBeenCalledWith({
        tableId,
        cell: pasteRo.cell,
        tableData,
        fields: mockFields.slice(pasteRo.cell[0]).concat(mockNewFields),
        records: mockRecords.slice(pasteRo.cell[1]).concat(mockNewRecords),
        transactionKey: testTransactionKey,
      });
      expect(result).toBeUndefined();
    });
  });
});
