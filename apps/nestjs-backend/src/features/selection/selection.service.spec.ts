/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IFieldVo, IRecord } from '@teable-group/core';
import {
  CellValueType,
  DbFieldType,
  FieldKeyType,
  FieldType,
  SpaceRole,
  getPermissions,
  nullsToUndefined,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { RangeType } from '@teable-group/openapi';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import type { DeepMockProxy } from 'vitest-mock-extended';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { FieldCreatingService } from '../field/field-calculate/field-creating.service';
import { FieldService } from '../field/field.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByVo } from '../field/model/factory';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';
import { SelectionModule } from './selection.module';
import { SelectionService } from './selection.service';

describe('selectionService', () => {
  let selectionService: SelectionService;
  let recordService: RecordService;
  let fieldService: FieldService;
  let prismaService: DeepMockProxy<PrismaService>;
  let recordOpenApiService: RecordOpenApiService;
  let fieldCreatingService: FieldCreatingService;
  let clsService: ClsService<IClsStore>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, SelectionModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep<PrismaService>())
      .compile();

    selectionService = module.get<SelectionService>(SelectionService);
    fieldService = module.get<FieldService>(FieldService);
    recordService = module.get<RecordService>(RecordService);
    recordOpenApiService = module.get<RecordOpenApiService>(RecordOpenApiService);
    fieldCreatingService = module.get<FieldCreatingService>(FieldCreatingService);
    clsService = module.get<ClsService<IClsStore>>(ClsService);

    prismaService = module.get<PrismaService>(
      PrismaService
    ) as unknown as DeepMockProxy<PrismaService>;
    mockReset(prismaService);
  });

  const tableId = 'table1';
  const viewId = 'view1';

  describe('copy', () => {
    const range = '[[0, 0], [1, 1]]';

    it('should return merged ranges data', async () => {
      const mockSelectionCtxRecords = [
        {
          id: 'record1',
          recordOrder: {},
          fields: {
            field1: '1',
            field2: '2',
            field3: '3',
          },
        },
        {
          id: 'record2',
          recordOrder: {},
          fields: {
            field1: '1',
            field2: '2',
          },
        },
      ];
      const mockSelectionCtxFields = [
        { id: 'field1', name: 'Field 1', type: FieldType.SingleLineText },
        { id: 'field2', name: 'Field 2', type: FieldType.SingleLineText },
      ];
      vi.spyOn(selectionService as any, 'getSelectionCtxByRange').mockReturnValue({
        records: mockSelectionCtxRecords,
        fields: mockSelectionCtxFields,
      });

      const result = await selectionService.copy(tableId, viewId, {
        ranges: range,
      });

      expect(result?.content).toEqual('1\t2\n1\t2');
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
      const result = selectionService['parseCopyContent'](content);

      // Verify the result
      expect(result).toEqual(expectedParsedContent);
    });
  });

  describe('calculateExpansion', () => {
    it('should calculate the number of rows and columns to expand', async () => {
      // Input
      const tableSize: [number, number] = [5, 4];
      const cell: [number, number] = [2, 3];
      const tableDataSize: [number, number] = [2, 2];
      const expectedExpansion = [0, 1];

      // Perform the calculation
      const result = await clsService.runWith(
        {
          user: {} as any,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () => selectionService['calculateExpansion'](tableSize, cell, tableDataSize)
      );

      // no permission to expand column
      // Perform the calculation
      const resultNoPermission = await clsService.runWith(
        {
          user: {} as any,
          tx: {},
          permissions: getPermissions(SpaceRole.Editor),
        },
        async () => selectionService['calculateExpansion'](tableSize, cell, tableDataSize)
      );

      // Verify the result
      expect(result).toEqual(expectedExpansion);
      expect(resultNoPermission).toEqual([0, expectedExpansion[1]]);
    });
  });

  describe('expandRows', () => {
    it('should expand the rows and create new records', async () => {
      // Mock dependencies
      const tableId = 'table1';
      const numRowsToExpand = 3;
      const expectedRecords = [
        { id: 'record1', fields: {} },
        { id: 'record2', fields: {} },
      ] as IRecord[];
      vi.spyOn(recordOpenApiService, 'createRecords').mockResolvedValueOnce({
        records: expectedRecords,
      });

      // Perform expanding rows
      const result = await selectionService['expandRows']({
        tableId,
        numRowsToExpand,
      });

      // Verify the multipleCreateRecords call
      expect(recordOpenApiService.createRecords).toHaveBeenCalledTimes(1);
      expect(recordOpenApiService.createRecords).toHaveBeenCalledWith(
        tableId,
        Array.from({ length: numRowsToExpand }, () => ({ fields: {} }))
      );

      // Verify the result
      expect(result).toEqual(expectedRecords);
    });

    it('should return empty array when numRowsToExpand is 0', async () => {
      const result = await selectionService['expandRows']({
        tableId: 'table1',
        numRowsToExpand: 0,
      });

      expect(result).toEqual([]);
    });
  });

  describe('expandColumns', () => {
    it('should expand the columns and create new fields', async () => {
      vi.spyOn(fieldService as any, 'generateDbFieldName').mockReturnValue('fieldName');
      // Mock dependencies
      const tableId = 'table1';
      // const viewId = 'view1';
      const header = [
        { id: '3', name: 'Email', type: FieldType.SingleLineText },
        { id: '4', name: 'Phone', type: FieldType.SingleLineText },
      ] as IFieldVo[];
      const numColsToExpand = 2;
      vi.spyOn(fieldCreatingService, 'createField').mockResolvedValueOnce(header[0]);
      vi.spyOn(fieldCreatingService, 'createField').mockResolvedValueOnce(header[1]);

      // Perform expanding columns
      const result = await selectionService['expandColumns']({
        tableId,
        header,
        numColsToExpand,
      });

      // Verify the createField calls
      expect(fieldCreatingService.createField).toHaveBeenCalledTimes(2);

      // Verify the result
      expect(result.length).toEqual(2);
    });
  });

  describe('collectionAttachment', () => {
    it('should return attachments based on tokens', async () => {
      const fields: IFieldInstance[] = [
        createFieldInstanceByVo({
          id: '1',
          name: 'attachments',
          type: FieldType.Attachment,
          options: {},
          dbFieldName: 'attachments',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Json,
        }),
      ];
      const tableData: string[][] = [
        ['file1.png (https://xxx.xxx/token1),file2.png (https://xxx.xxx/token2)'],
        ['file3.png (https://xxx.xxx/token3)'],
      ];

      const mockAttachment: any[] = [
        {
          token: 'token1',
          path: '',
          url: '',
          size: 1,
          mimetype: 'image/png',
          width: null,
          height: null,
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

      prismaService.attachments.findMany.mockResolvedValue(mockAttachment);

      const result = await selectionService['collectionAttachment']({
        tableData,
        fields,
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
      expect(result).toEqual(nullsToUndefined(mockAttachment));
    });
  });

  describe('fillCells', () => {
    it('should fill the cells with provided table data', async () => {
      // Mock data
      const tableData = [
        ['A1', 'B1', 'C1'],
        ['A2', 'B2', 'C2'],
        ['A3', 'B3', 'C3'],
      ];

      const fields = [
        {
          id: 'field1',
          name: 'Field 1',
          type: FieldType.SingleLineText,
          options: {},
          dbFieldName: 'Field 1',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          columnMeta: {},
        },
        {
          id: 'field2',
          name: 'Field 2',
          type: FieldType.SingleLineText,
          options: {},
          dbFieldName: 'Field 2',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          columnMeta: {},
        },
        {
          id: 'field3',
          name: 'Field 3',
          type: FieldType.SingleLineText,
          options: {},
          dbFieldName: 'Field 3',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          columnMeta: {},
        },
      ].map(createFieldInstanceByVo);

      const records = [
        { id: 'record1', recordOrder: {}, fields: {} },
        { id: 'record2', recordOrder: {}, fields: {} },
        { id: 'record3', recordOrder: {}, fields: {} },
      ];

      // Execute the method
      const updateRecordsRo = await selectionService['fillCells']({
        tableId,
        tableData,
        fields,
        records,
      });

      expect(updateRecordsRo).toEqual({
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: records[0].id,
            fields: { field1: 'A1', field2: 'B1', field3: 'C1' },
          },
          {
            id: records[1].id,
            fields: { field1: 'A2', field2: 'B2', field3: 'C2' },
          },
          {
            id: records[2].id,
            fields: { field1: 'A3', field2: 'B3', field3: 'C3' },
          },
        ],
      });
    });
  });

  describe('expandPasteContent', () => {
    it('should expand data when range is multiple of paste data size', () => {
      const pasteData = [
        ['1', '2'],
        ['3', '4'],
      ];
      const range = [
        [0, 0],
        [3, 3],
      ] as [[number, number], [number, number]];
      const expected = [
        ['1', '2', '1', '2'],
        ['3', '4', '3', '4'],
        ['1', '2', '1', '2'],
        ['3', '4', '3', '4'],
      ];

      expect(selectionService['expandPasteContent'](pasteData, range)).toEqual(expected);
    });

    it('should not expand data when range is not multiple of paste data size', () => {
      const pasteData = [
        ['1', '2'],
        ['3', '4'],
      ];
      const range = [
        [0, 0],
        [2, 2],
      ] as [[number, number], [number, number]];

      expect(selectionService['expandPasteContent'](pasteData, range)).toEqual(pasteData);
    });
  });

  describe('getRangeCell', () => {
    const maxRange = [
      [0, 0],
      [5, 5],
    ] as [number, number][];

    it('should return correct range for column type', () => {
      const range = [[1, 2]] as [number, number][];
      const type = RangeType.Columns;
      const expected = [
        [1, 0],
        [2, 5],
      ];

      expect(selectionService['getRangeCell'](maxRange, range, type)).toEqual(expected);
    });

    it('should return correct range for row type', () => {
      const range = [[1, 2]] as [number, number][];
      const type = RangeType.Rows;
      const expected = [
        [0, 1],
        [5, 2],
      ];

      expect(selectionService['getRangeCell'](maxRange, range, type)).toEqual(expected);
    });

    it('should return input range for default type', () => {
      const range = [
        [1, 2],
        [3, 4],
      ] as [number, number][];
      const type = undefined;

      expect(selectionService['getRangeCell'](maxRange, range, type)).toEqual(range);
    });
  });

  describe('paste', () => {
    const content = 'A1\tB1\tC1\nA2\tB2\tC2\nA3\tB3\tC3';
    const tableData = [
      ['A1', 'B1', 'C1'],
      ['A2', 'B2', 'C2'],
      ['A3', 'B3', 'C3'],
    ];

    it('should paste table data and update records', async () => {
      // Mock input parameters
      const tableId = 'testTableId';
      const viewId = 'testViewId';

      // Mock dependencies
      const mockFields = [
        {
          id: 'fieldId1',
          name: 'Field 1',
          type: FieldType.SingleLineText,
          options: {},
          dbFieldName: 'Field 1',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          columnMeta: {},
        },
        {
          id: 'fieldId2',
          name: 'Field 2',
          type: FieldType.SingleLineText,
          options: {},
          dbFieldName: 'Field 2',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          columnMeta: {},
        },
        {
          id: 'fieldId3',
          name: 'Field 3',
          type: FieldType.SingleLineText,
          options: {},
          dbFieldName: 'Field 3',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          columnMeta: {},
        },
      ].map(createFieldInstanceByVo);

      const pasteRo = {
        range: [
          [2, 1],
          [2, 1],
        ] as [number, number][],
        content,
        header: mockFields,
      };

      const mockRecords = [
        { id: 'recordId1', fields: {} },
        { id: 'recordId2', fields: {} },
      ];

      const mockNewFields = [
        {
          id: 'newFieldId1',
          name: 'Field 1',
          type: FieldType.SingleLineText,
          options: {},
          dbFieldName: 'Field 1',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          columnMeta: {},
        },
        {
          id: 'newFieldId2',
          name: 'Field 2',
          type: FieldType.SingleLineText,
          options: {},
          dbFieldName: 'Field 2',
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
          columnMeta: {},
        },
      ].map(createFieldInstanceByVo);

      const mockNewRecords = [
        { id: 'newRecordId1', fields: {} },
        { id: 'newRecordId2', fields: {} },
      ];

      vi.spyOn(selectionService as any, 'parseCopyContent').mockReturnValue(tableData);

      vi.spyOn(recordService, 'getRowCount').mockResolvedValue(mockRecords.length);
      vi.spyOn(recordService, 'getRecordsFields').mockResolvedValue(
        mockRecords.slice(pasteRo.range[0][1])
      );

      vi.spyOn(fieldService, 'getFieldInstances').mockResolvedValue(mockFields);

      vi.spyOn(selectionService as any, 'expandRows').mockResolvedValue({
        records: mockNewRecords,
      });
      vi.spyOn(selectionService as any, 'expandColumns').mockResolvedValue(mockNewFields);

      vi.spyOn(recordOpenApiService, 'updateRecords').mockResolvedValue(null as any);

      prismaService.$tx.mockImplementation(async (fn, _options) => {
        await fn(prismaService);
      });

      // Call the method
      const result = await clsService.runWith(
        {
          user: {} as any,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () => await selectionService.paste(tableId, viewId, pasteRo)
      );

      // Assertions
      expect(selectionService['parseCopyContent']).toHaveBeenCalledWith(content);
      expect(recordService.getRowCount).toHaveBeenCalledWith(tableId, viewId);
      expect(recordService.getRecordsFields).toHaveBeenCalledWith(tableId, {
        viewId,
        skip: 1,
        take: tableData.length,
        fieldKeyType: 'id',
      });

      expect(fieldService.getFieldInstances).toHaveBeenCalledWith(tableId, {
        viewId,
        filterHidden: true,
      });

      expect(selectionService['expandColumns']).toHaveBeenCalledWith({
        tableId,
        header: mockFields,
        numColsToExpand: 2,
      });

      expect(selectionService['expandRows']).toHaveBeenCalledWith({
        tableId,
        numRowsToExpand: 2,
      });

      expect(result).toEqual([
        [2, 1],
        [4, 3],
      ]);
    });
  });

  describe('clear', () => {
    const tableId = 'testTableId';
    const viewId = 'testViewId';
    const records = [
      {
        id: 'record1',
        fields: {
          field1: '1',
          field2: '2',
        },
      },
    ];
    const fields = [
      { id: 'field1', name: 'Field 1', type: FieldType.SingleLineText },
      { id: 'field2', name: 'Field 2', type: FieldType.SingleLineText },
    ];

    it('should clear both fields and records when type is undefined', async () => {
      // Mock the required dependencies and their methods
      const clearRo = {
        ranges: [
          [0, 0],
          [0, 0],
        ] as [number, number][],
      };
      // Mock the updateRecordsRo object
      const updateRecordsRo = {
        fieldKeyType: FieldKeyType.Id,
        records: [{ id: 'record1', fields: { field1: null } }],
      };

      // Mock the required methods from the service
      selectionService['getSelectionCtxByRange'] = vi.fn().mockResolvedValue({ fields, records });
      selectionService['fillCells'] = vi.fn().mockResolvedValue(updateRecordsRo);
      recordOpenApiService.updateRecords = vi.fn().mockResolvedValue(null);

      // Call the clear method
      await selectionService.clear(tableId, viewId, clearRo);

      // Expect the methods to have been called with the correct parameters
      expect(selectionService['getSelectionCtxByRange']).toHaveBeenCalledWith(
        tableId,
        viewId,
        clearRo.ranges,
        undefined
      );
      expect(selectionService['fillCells']).toHaveBeenCalledWith({
        tableId,
        tableData: [],
        fields,
        records,
      });
      expect(recordOpenApiService.updateRecords).toHaveBeenCalledWith(tableId, updateRecordsRo);
    });
  });
});
