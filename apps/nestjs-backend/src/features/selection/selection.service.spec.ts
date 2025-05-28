/* eslint-disable @typescript-eslint/no-explicit-any */
import { faker } from '@faker-js/faker';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IFieldOptionsVo, IFieldVo } from '@teable/core';
import {
  CellValueType,
  Colors,
  DbFieldType,
  FieldKeyType,
  FieldType,
  MultiNumberDisplayType,
  NumberFormattingType,
  SingleLineTextDisplayType,
  SingleNumberDisplayType,
  TIME_ZONE_LIST,
  defaultUserFieldOptions,
  getPermissions,
  Role,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { RangeType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import type { DeepMockProxy } from 'vitest-mock-extended';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { AggregationService } from '../aggregation/aggregation.service';
import { FieldCreatingService } from '../field/field-calculate/field-creating.service';
import { FieldSupplementService } from '../field/field-calculate/field-supplement.service';
import { FieldService } from '../field/field.service';
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
  let fieldSupplementService: FieldSupplementService;
  let clsService: ClsService<IClsStore>;
  let aggregationService: AggregationService;

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
    fieldSupplementService = module.get<FieldSupplementService>(FieldSupplementService);
    clsService = module.get<ClsService<IClsStore>>(ClsService);
    aggregationService = module.get<AggregationService>(AggregationService);

    prismaService = module.get<PrismaService>(
      PrismaService
    ) as unknown as DeepMockProxy<PrismaService>;
    mockReset(prismaService);
  });

  const tableId = 'table1';
  const viewId = 'view1';

  describe('copy', () => {
    it('should return merged ranges data', async () => {
      const mockSelectionCtxRecords = [
        {
          id: 'record1',
          fields: {
            field1: '1',
            field2: '2',
            field3: '3',
          },
        },
        {
          id: 'record2',
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

      const result = await selectionService.copy(tableId, {
        viewId,
        ranges: [
          [0, 0],
          [1, 1],
        ],
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
          origin: {
            ip: '127.0.0.1',
            byApi: false,
            userAgent: 'test',
            referer: 'test',
          },
          permissions: getPermissions(Role.Owner),
        },
        async () => selectionService['calculateExpansion'](tableSize, cell, tableDataSize)
      );

      // no permission to expand column
      // Perform the calculation
      const resultNoPermission = await clsService.runWith(
        {
          user: {} as any,
          tx: {},
          origin: {
            ip: '127.0.0.1',
            byApi: false,
            userAgent: 'test',
            referer: 'test',
          },
          permissions: getPermissions(Role.Editor),
        },
        async () => selectionService['calculateExpansion'](tableSize, cell, tableDataSize)
      );

      // Verify the result
      expect(result).toEqual(expectedExpansion);
      expect(resultNoPermission).toEqual([0, expectedExpansion[1]]);
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
      vi.spyOn(fieldSupplementService, 'prepareCreateField').mockResolvedValueOnce(header[0]);
      vi.spyOn(fieldSupplementService, 'prepareCreateField').mockResolvedValueOnce(header[1]);
      vi.spyOn(fieldCreatingService, 'alterCreateField').mockImplementation(
        (() => undefined) as any
      );

      // Perform expanding columns
      const result = await selectionService['expandColumns']({
        tableId,
        header,
        numColsToExpand,
      });

      // Verify the createField calls
      expect(fieldCreatingService.alterCreateField).toHaveBeenCalledTimes(2);

      // Verify the result
      expect(result.length).toEqual(2);
    });
  });

  describe('fillCells', () => {
    it('should return updated records with new fields merged when newRecords is provided', () => {
      const oldRecords = [
        { id: '1', fields: { a: 1, b: 2 } },
        { id: '2', fields: { c: 3, d: 4 } },
      ];
      const newRecords = [{ fields: { b: 20 } }, { fields: { d: 40, e: 5 } }];

      const result = selectionService['fillCells'](oldRecords, newRecords);

      expect(result).toEqual({
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          { id: '1', fields: { a: 1, b: 20 } },
          { id: '2', fields: { c: 3, d: 40, e: 5 } },
        ],
      });
    });

    it('should return records with empty fields when newRecords is undefined', () => {
      const oldRecords = [
        { id: '1', fields: { a: 1, b: 2 } },
        { id: '2', fields: { c: 3, d: 4 } },
      ];

      const result = selectionService['fillCells'](oldRecords);

      expect(result).toEqual({
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          { id: '1', fields: {} },
          { id: '2', fields: {} },
        ],
      });
    });

    it('should return records with empty fields when newRecords is an empty array', () => {
      const oldRecords = [
        { id: '1', fields: { a: 1, b: 2 } },
        { id: '2', fields: { c: 3, d: 4 } },
      ];

      const result = selectionService['fillCells'](oldRecords, []);

      expect(result).toEqual({
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          { id: '1', fields: {} },
          { id: '2', fields: {} },
        ],
      });
    });

    it('should merge fields correctly when newRecords has fewer elements', () => {
      const oldRecords = [
        { id: '1', fields: { a: 1, b: 2 } },
        { id: '2', fields: { c: 3, d: 4 } },
      ];
      const newRecords = [{ fields: { b: 20 } }];

      const result = selectionService['fillCells'](oldRecords, newRecords);

      expect(result).toEqual({
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          { id: '1', fields: { a: 1, b: 20 } },
          { id: '2', fields: {} },
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
        ranges: [
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

      vi.spyOn(selectionService as any, 'parseCopyContent').mockReturnValue(tableData);

      vi.spyOn(aggregationService, 'performRowCount').mockResolvedValue({
        rowCount: mockRecords.length,
      });
      vi.spyOn(recordService, 'getRecordsFields').mockResolvedValue(
        mockRecords.slice(pasteRo.ranges[0][1])
      );

      vi.spyOn(fieldService, 'getFieldInstances').mockResolvedValue(mockFields);

      vi.spyOn(selectionService as any, 'expandColumns').mockResolvedValue(mockNewFields);

      vi.spyOn(recordOpenApiService, 'updateRecords').mockResolvedValue({} as any);

      vi.spyOn(recordOpenApiService, 'createRecords').mockResolvedValue({ records: [] } as any);

      prismaService.$tx.mockImplementation(async (fn, _options) => {
        return await fn(prismaService);
      });

      // Call the method
      const result = await clsService.runWith(
        {
          user: {} as any,
          tx: {},
          origin: {
            ip: '127.0.0.1',
            byApi: false,
            userAgent: 'test',
            referer: 'test',
          },
          permissions: getPermissions(Role.Owner),
        },
        async () => await selectionService.paste(tableId, { viewId, ...pasteRo })
      );

      // Assertions
      expect(selectionService['parseCopyContent']).toHaveBeenCalledWith(content);
      expect(aggregationService.performRowCount).toHaveBeenCalledWith(tableId, { viewId });
      expect(recordService.getRecordsFields).toHaveBeenCalledWith(tableId, {
        viewId,
        skip: 1,
        projection: ['fieldId3'],
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

      expect(result).toEqual([
        [2, 1],
        [6, 3],
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
      selectionService['tableDataToRecords'] = vi.fn().mockReturnValue([{ fields: {} }]);
      selectionService['fillCells'] = vi.fn().mockReturnValue(updateRecordsRo);
      recordOpenApiService.updateRecords = vi.fn().mockResolvedValue(null);

      // Call the clear method
      await selectionService.clear(tableId, { viewId, ...clearRo });

      // Expect the methods to have been called with the correct parameters
      expect(selectionService['getSelectionCtxByRange']).toHaveBeenCalledWith(tableId, {
        viewId,
        ranges: clearRo.ranges,
      });
      expect(selectionService['fillCells']).toHaveBeenCalledWith(records, [{ fields: {} }]);
      expect(recordOpenApiService.updateRecords).toHaveBeenCalledWith(
        tableId,
        updateRecordsRo,
        undefined
      );
    });
  });

  describe('optionsRoToVoByCvType', () => {
    it('should return correct options for Number type', () => {
      const cellValueType = CellValueType.Number;
      const options: IFieldOptionsVo = {
        formatting: {
          type: NumberFormattingType.Decimal,
          precision: 3,
        },
        showAs: {
          type: faker.helpers.arrayElement(Object.values(SingleNumberDisplayType)),
          color: faker.helpers.arrayElement(Object.values(Colors)),
          showValue: faker.datatype.boolean(),
          maxValue: faker.number.int(),
        },
      };

      const result = selectionService['optionsRoToVoByCvType'](cellValueType, options);

      expect(result).toEqual({
        type: FieldType.Number,
        options,
      });
    });

    it('should return correct options for DateTime type', () => {
      const cellValueType = CellValueType.DateTime;
      const options: IFieldOptionsVo = {
        formatting: {
          date: 'MM/DD/YYYY',
          time: 'HH:mm',
          timeZone: TIME_ZONE_LIST[0],
        },
      };

      const result = selectionService['optionsRoToVoByCvType'](cellValueType, options);

      expect(result).toEqual({
        type: FieldType.Date,
        options,
      });
    });

    it('should return correct options for String type', () => {
      const cellValueType = CellValueType.String;
      const options: IFieldOptionsVo = {
        showAs: {
          type: faker.helpers.arrayElement(Object.values(SingleLineTextDisplayType)),
        },
      };

      const result = selectionService['optionsRoToVoByCvType'](cellValueType, options);

      expect(result).toEqual({
        type: FieldType.SingleLineText,
        options,
      });
    });

    it('should return correct options for Boolean type', () => {
      const cellValueType = CellValueType.Boolean;
      const options: IFieldOptionsVo = {};

      const result = selectionService['optionsRoToVoByCvType'](cellValueType, options);

      expect(result).toEqual({
        type: FieldType.Checkbox,
        options: {},
      });
    });

    it('should throw BadRequestException for invalid cellValueType', () => {
      const cellValueType = 'InvalidType' as any;
      const options: IFieldOptionsVo = {};

      expect(() => selectionService['optionsRoToVoByCvType'](cellValueType, options)).toThrowError(
        'Invalid cellValueType'
      );
    });
  });

  describe('fieldVoToRo', () => {
    it('should return default SingleLineText field if no field is provided', () => {
      const result = selectionService['fieldVoToRo'](undefined);

      expect(result).toEqual({
        type: FieldType.SingleLineText,
      });
    });

    it('should return correct User field for CreatedBy and LastModifiedBy types', () => {
      const createdByField: IFieldVo = {
        type: FieldType.CreatedBy,
        id: '',
        name: '',
        description: '',
        isComputed: true,
        options: undefined as any,
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        dbFieldName: '',
      };

      const lastModifiedByField: IFieldVo = {
        type: FieldType.LastModifiedBy,
        id: '',
        options: undefined as any,
        name: '',
        isComputed: true,
        description: '',
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        dbFieldName: '',
      };

      const createdByResult = selectionService['fieldVoToRo'](createdByField);
      const lastModifiedByResult = selectionService['fieldVoToRo'](lastModifiedByField);

      expect(createdByResult).toEqual({
        type: FieldType.User,
        options: defaultUserFieldOptions,
        name: '',
        description: '',
      });

      expect(lastModifiedByResult).toEqual({
        type: FieldType.User,
        options: defaultUserFieldOptions,
        name: '',
        description: '',
      });
    });

    it('should handle computed fields with valid cellValueType', () => {
      const computedField: IFieldVo = {
        id: '',
        name: '',
        description: '',
        type: FieldType.Formula,
        isComputed: true,
        cellValueType: CellValueType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
          showAs: {
            type: MultiNumberDisplayType.Bar,
            color: Colors.Blue,
            showValue: true,
            maxValue: 100,
          },
        },
        dbFieldType: DbFieldType.Text,
        dbFieldName: '',
      };

      const optionsRoToVoByCvTypeMock = vitest.spyOn(
        selectionService as any,
        'optionsRoToVoByCvType'
      );

      const result = selectionService['fieldVoToRo'](computedField);

      expect(result).toEqual({
        name: '',
        description: '',
        type: FieldType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
          showAs: {
            type: MultiNumberDisplayType.Bar,
            color: Colors.Blue,
            showValue: true,
            maxValue: 100,
          },
        },
      });

      expect(optionsRoToVoByCvTypeMock).toHaveBeenCalledWith(
        computedField.cellValueType,
        computedField.options
      );

      optionsRoToVoByCvTypeMock.mockRestore();
    });

    it('should handle computed fields with invalid cellValueType', () => {
      const computedField: IFieldVo = {
        id: '',
        name: '',
        description: '',
        type: FieldType.Number,
        isComputed: false,
        cellValueType: CellValueType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
          showAs: {
            type: MultiNumberDisplayType.Bar,
            color: Colors.Blue,
            showValue: true,
            maxValue: 100,
          },
        },
        dbFieldType: DbFieldType.Integer,
        dbFieldName: '',
      };

      const optionsRoToVoByCvTypeMock = vitest.spyOn(
        selectionService as any,
        'optionsRoToVoByCvType'
      );

      const result = selectionService['fieldVoToRo'](computedField);

      expect(result).toEqual({
        name: '',
        description: '',
        type: FieldType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
          showAs: {
            type: MultiNumberDisplayType.Bar,
            color: Colors.Blue,
            showValue: true,
            maxValue: 100,
          },
        },
      });

      expect(optionsRoToVoByCvTypeMock).not.toHaveBeenCalled();

      optionsRoToVoByCvTypeMock.mockRestore();
    });
  });

  describe('lookupOptionsRoToVo', () => {
    it('should return MultipleSelect options for SingleSelect with isMultipleCellValue', () => {
      const field: IFieldVo = {
        type: FieldType.SingleSelect,
        isMultipleCellValue: true,
        options: {
          choices: [],
        },
        id: '',
        name: '',
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        dbFieldName: '',
      };

      const result = selectionService['lookupOptionsRoToVo'](field);

      expect(result).toEqual({
        type: FieldType.MultipleSelect,
        options: field.options,
      });
    });

    it('should return User options with isMultiple true for FieldType User with isMultipleCellValue', () => {
      const field: IFieldVo = {
        type: FieldType.User,
        isMultipleCellValue: true,
        options: {
          isMultiple: false,
          shouldNotify: false,
        },
        id: '',
        name: '',
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        dbFieldName: '',
      };
      const result = selectionService['lookupOptionsRoToVo'](field);

      expect(result).toEqual({
        type: FieldType.User,
        options: {
          ...field.options,
          isMultiple: true,
        },
      });
    });

    it('should return the same type and options for other cases', () => {
      const field: IFieldVo = {
        type: FieldType.SingleLineText,
        isMultipleCellValue: false,
        options: {},
        id: '',
        name: '',
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        dbFieldName: '',
      };

      const result = selectionService['lookupOptionsRoToVo'](field);

      expect(result).toEqual({
        type: field.type,
        options: field.options,
      });
    });
  });

  describe('tableDataToRecords', () => {
    it('should return the cells with provided table data', async () => {
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

      // Execute the method
      const updateRecordsRo = selectionService['tableDataToRecords']({
        tableData,
        fields,
      });

      expect(updateRecordsRo).toEqual([
        {
          fields: { field1: 'A1', field2: 'B1', field3: 'C1' },
        },
        {
          fields: { field1: 'A2', field2: 'B2', field3: 'C2' },
        },
        {
          fields: { field1: 'A3', field2: 'B3', field3: 'C3' },
        },
      ]);
    });
  });
});
