/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { CalculationModule } from './calculation.module';
import { LinkService } from './link.service';

describe('LinkService', () => {
  let service: LinkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, CalculationModule],
    }).compile();

    service = module.get<LinkService>(LinkService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // describe('getCellMutation', () => {
  //   let fieldMapByTableId: IFieldMapByTableId = {};
  //   beforeEach(() => {
  //     fieldMapByTableId = {
  //       tableA: {
  //         'ManyOne-LinkB': {
  //           id: 'ManyOne-LinkB',
  //           type: FieldType.Link,
  //           dbFieldName: 'ManyOne-LinkB',
  //           options: {
  //             relationship: Relationship.ManyOne,
  //             foreignTableId: 'tableB',
  //             lookupFieldId: 'fieldB',
  //             dbForeignKeyName: '__fk_ManyOne-LinkB',
  //             symmetricFieldId: 'OneMany-LinkA',
  //           },
  //         } as LinkFieldDto,
  //       },
  //       tableB: {
  //         'OneMany-LinkA': {
  //           id: 'OneMany-LinkA',
  //           type: FieldType.Link,
  //           dbFieldName: 'OneMany-LinkA',
  //           options: {
  //             relationship: Relationship.OneMany,
  //             foreignTableId: 'tableA',
  //             lookupFieldId: 'fieldA',
  //             dbForeignKeyName: '__fk_ManyOne-LinkB',
  //             symmetricFieldId: 'ManyOne-LinkB',
  //           },
  //         } as LinkFieldDto,
  //       },
  //     };
  //   });

  //   it('should create correct ForeignKeyParams when add value for ManyOne field', () => {
  //     const ctx1: ILinkCellContext[] = [
  //       {
  //         recordId: 'A1',
  //         fieldId: 'ManyOne-LinkB',
  //         newValue: { id: 'B1' },
  //       },
  //     ];

  //     const result1 = service['getRecordMapStructAndForeignKeyParams'](
  //       'tableA',
  //       fieldMapByTableId,
  //       ctx1
  //     );
  //     expect(result1.recordMapByTableId).toEqual({
  //       tableA: {
  //         A1: { fieldA: undefined, 'ManyOne-LinkB': undefined, '__fk_ManyOne-LinkB': undefined },
  //       },
  //       tableB: { B1: { fieldB: undefined, 'OneMany-LinkA': undefined } },
  //     });

  //     expect(result1.updateForeignKeyParams).toEqual([
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B1',
  //       },
  //     ]);
  //   });

  //   it('should create correct ForeignKeyParams when delete value for ManyOne field', () => {
  //     const ctx1: ILinkCellContext[] = [
  //       {
  //         recordId: 'A1',
  //         fieldId: 'ManyOne-LinkB',
  //         oldValue: { id: 'B1' },
  //         newValue: undefined,
  //       },
  //     ];

  //     const result1 = service['getRecordMapStructAndForeignKeyParams'](
  //       'tableA',
  //       fieldMapByTableId,
  //       ctx1
  //     );
  //     expect(result1.recordMapByTableId).toEqual({
  //       tableA: {
  //         A1: { fieldA: undefined, 'ManyOne-LinkB': undefined, '__fk_ManyOne-LinkB': undefined },
  //       },
  //       tableB: { B1: { fieldB: undefined, 'OneMany-LinkA': undefined } },
  //     });

  //     expect(result1.updateForeignKeyParams).toEqual([
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: null,
  //       },
  //     ]);
  //   });

  //   it('should create correct ForeignKeyParams when replace value for ManyOne field', () => {
  //     const ctx1: ILinkCellContext[] = [
  //       {
  //         recordId: 'A1',
  //         fieldId: 'ManyOne-LinkB',
  //         oldValue: { id: 'B1' },
  //         newValue: { id: 'B2' },
  //       },
  //     ];

  //     const result1 = service['getRecordMapStructAndForeignKeyParams'](
  //       'tableA',
  //       fieldMapByTableId,
  //       ctx1
  //     );

  //     expect(result1.recordMapByTableId).toEqual({
  //       tableA: {
  //         A1: { fieldA: undefined, 'ManyOne-LinkB': undefined, '__fk_ManyOne-LinkB': undefined },
  //       },
  //       tableB: {
  //         B1: { fieldB: undefined, 'OneMany-LinkA': undefined },
  //         B2: { fieldB: undefined, 'OneMany-LinkA': undefined },
  //       },
  //     });

  //     expect(result1.updateForeignKeyParams).toEqual([
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B2',
  //       },
  //     ]);
  //   });

  //   it('should create correct ForeignKeyParams when add value for oneMany field', () => {
  //     const ctx1: ILinkCellContext[] = [
  //       {
  //         recordId: 'B1',
  //         fieldId: 'OneMany-LinkA',
  //         newValue: [{ id: 'A1' }],
  //       },
  //     ];

  //     const result1 = service['getRecordMapStructAndForeignKeyParams'](
  //       'tableB',
  //       fieldMapByTableId,
  //       ctx1
  //     );
  //     expect(result1.recordMapByTableId).toEqual({
  //       tableA: {
  //         A1: { fieldA: undefined, 'ManyOne-LinkB': undefined, '__fk_ManyOne-LinkB': undefined },
  //       },
  //       tableB: { B1: { fieldB: undefined, 'OneMany-LinkA': undefined } },
  //     });

  //     expect(result1.updateForeignKeyParams).toEqual([
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B1',
  //       },
  //     ]);
  //   });

  //   it('should create correct ForeignKeyParams when del value for oneMany field', () => {
  //     const ctx1: ILinkCellContext[] = [
  //       {
  //         recordId: 'B1',
  //         fieldId: 'OneMany-LinkA',
  //         oldValue: [{ id: 'A1' }],
  //         newValue: undefined,
  //       },
  //     ];

  //     const result1 = service['getRecordMapStructAndForeignKeyParams'](
  //       'tableB',
  //       fieldMapByTableId,
  //       ctx1
  //     );
  //     expect(result1.recordMapByTableId).toEqual({
  //       tableA: {
  //         A1: { fieldA: undefined, 'ManyOne-LinkB': undefined, '__fk_ManyOne-LinkB': undefined },
  //       },
  //       tableB: { B1: { fieldB: undefined, 'OneMany-LinkA': undefined } },
  //     });

  //     expect(result1.updateForeignKeyParams).toEqual([
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: null,
  //       },
  //     ]);
  //   });

  //   it('should create correct ForeignKeyParams when replace value for oneMany field', () => {
  //     const ctx1: ILinkCellContext[] = [
  //       {
  //         recordId: 'B1',
  //         fieldId: 'OneMany-LinkA',
  //         oldValue: [{ id: 'A1' }],
  //         newValue: [{ id: 'A1' }, { id: 'A2' }],
  //       },
  //     ];

  //     const result1 = service['getRecordMapStructAndForeignKeyParams'](
  //       'tableB',
  //       fieldMapByTableId,
  //       ctx1
  //     );

  //     expect(result1.recordMapByTableId).toEqual({
  //       tableA: {
  //         A1: { fieldA: undefined, 'ManyOne-LinkB': undefined, '__fk_ManyOne-LinkB': undefined },
  //         A2: { fieldA: undefined, 'ManyOne-LinkB': undefined, '__fk_ManyOne-LinkB': undefined },
  //       },
  //       tableB: { B1: { fieldB: undefined, 'OneMany-LinkA': undefined } },
  //     });

  //     expect(result1.updateForeignKeyParams).toEqual([
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: null,
  //       },
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B1',
  //       },
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A2',
  //         fRecordId: 'B1',
  //       },
  //     ]);
  //   });

  //   it('should throw error when when illegal value for oneMany field', () => {
  //     const ctx1: ILinkCellContext[] = [
  //       {
  //         recordId: 'B1',
  //         fieldId: 'OneMany-LinkA',
  //         oldValue: [{ id: 'A1' }],
  //         newValue: [{ id: 'A1' }, { id: 'A2' }],
  //       },
  //       {
  //         recordId: 'B2',
  //         fieldId: 'OneMany-LinkA',
  //         newValue: [{ id: 'A1' }, { id: 'A2' }],
  //       },
  //     ];

  //     expect(() =>
  //       service['getRecordMapStructAndForeignKeyParams']('tableB', fieldMapByTableId, ctx1)
  //     ).toThrow();
  //   });

  //   it('should update foreign key in memory correctly when add value', () => {
  //     const recordMapByTableId = {
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': undefined,
  //           '__fk_ManyOne-LinkB': undefined,
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': undefined,
  //         },
  //       },
  //     };

  //     const updateForeignKeyParams = [
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B1',
  //       },
  //     ];

  //     const result1 = service['updateForeignKeyInMemory'](
  //       updateForeignKeyParams,
  //       recordMapByTableId
  //     );

  //     expect(result1).toEqual({
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': { id: 'B1', title: 'B1' },
  //           '__fk_ManyOne-LinkB': 'B1',
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': [{ id: 'A1', title: 'A1' }],
  //         },
  //       },
  //     });
  //   });

  //   it('should update foreign key in memory correctly when del value', () => {
  //     const recordMapByTableId = {
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': { id: 'B1', title: 'B1' },
  //           '__fk_ManyOne-LinkB': 'B1',
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': [{ id: 'A1', title: 'A1' }],
  //         },
  //       },
  //     };

  //     const updateForeignKeyParams = [
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: null,
  //       },
  //     ];

  //     const result1 = service['updateForeignKeyInMemory'](
  //       updateForeignKeyParams,
  //       recordMapByTableId
  //     );

  //     expect(result1).toEqual({
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': null,
  //           '__fk_ManyOne-LinkB': null,
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': null,
  //         },
  //       },
  //     });
  //   });

  //   it('should update foreign key in memory correctly when replace value', () => {
  //     const recordMapByTableId = {
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': { id: 'B1', title: 'B1' },
  //           '__fk_ManyOne-LinkB': 'B1',
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': [{ id: 'A1', title: 'A1' }],
  //         },
  //         B2: {
  //           fieldB: 'B2',
  //           'OneMany-LinkA': undefined,
  //         },
  //       },
  //     };

  //     const updateForeignKeyParams = [
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B2',
  //       },
  //     ];

  //     const result1 = service['updateForeignKeyInMemory'](
  //       updateForeignKeyParams,
  //       recordMapByTableId
  //     );

  //     expect(result1).toEqual({
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': { id: 'B2', title: 'B2' },
  //           '__fk_ManyOne-LinkB': 'B2',
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': null,
  //         },
  //         B2: {
  //           fieldB: 'B2',
  //           'OneMany-LinkA': [{ id: 'A1', title: 'A1' }],
  //         },
  //       },
  //     });
  //   });

  //   it('should update foreign key in memory correctly when replace multiple value', () => {
  //     const recordMapByTableId = {
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': { id: 'B1', title: 'B1' },
  //           '__fk_ManyOne-LinkB': 'B1',
  //         },
  //         A2: {
  //           fieldA: 'A2',
  //           'ManyOne-LinkB': undefined,
  //           '__fk_ManyOne-LinkB': undefined,
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': [{ id: 'A1', title: 'A1' }],
  //         },
  //       },
  //     };

  //     const updateForeignKeyParams = [
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: null,
  //       },
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B1',
  //       },
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A2',
  //         fRecordId: 'B1',
  //       },
  //     ];

  //     const result1 = service['updateForeignKeyInMemory'](
  //       updateForeignKeyParams,
  //       recordMapByTableId
  //     );

  //     expect(result1).toEqual({
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': { id: 'B1', title: 'B1' },
  //           '__fk_ManyOne-LinkB': 'B1',
  //         },
  //         A2: {
  //           fieldA: 'A2',
  //           'ManyOne-LinkB': { id: 'B1', title: 'B1' },
  //           '__fk_ManyOne-LinkB': 'B1',
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': [
  //             { id: 'A1', title: 'A1' },
  //             { id: 'A2', title: 'A2' },
  //           ],
  //         },
  //       },
  //     });
  //   });

  //   it('should update foreign key in memory correctly event when illegal value', () => {
  //     const recordMapByTableId = {
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': { id: 'B1', title: 'B1' },
  //           '__fk_ManyOne-LinkB': 'B1',
  //         },
  //         A2: {
  //           fieldA: 'A2',
  //           'ManyOne-LinkB': undefined,
  //           '__fk_ManyOne-LinkB': undefined,
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': [{ id: 'A1', title: 'A1' }],
  //         },
  //         B2: {
  //           fieldB: 'B2',
  //           'OneMany-LinkA': undefined,
  //         },
  //       },
  //     };

  //     const updateForeignKeyParams = [
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: null,
  //       },
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B1',
  //       },
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A2',
  //         fRecordId: 'B1',
  //       },
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A1',
  //         fRecordId: 'B2',
  //       },
  //       {
  //         tableId: 'tableA',
  //         foreignTableId: 'tableB',
  //         mainLinkFieldId: 'ManyOne-LinkB',
  //         mainTableLookupFieldId: 'fieldA',
  //         foreignLinkFieldId: 'OneMany-LinkA',
  //         foreignTableLookupFieldId: 'fieldB',
  //         dbForeignKeyName: '__fk_ManyOne-LinkB',
  //         recordId: 'A2',
  //         fRecordId: 'B2',
  //       },
  //     ];

  //     const result1 = service['updateForeignKeyInMemory'](
  //       updateForeignKeyParams,
  //       recordMapByTableId
  //     );

  //     expect(result1).toEqual({
  //       tableA: {
  //         A1: {
  //           fieldA: 'A1',
  //           'ManyOne-LinkB': { id: 'B2', title: 'B2' },
  //           '__fk_ManyOne-LinkB': 'B2',
  //         },
  //         A2: {
  //           fieldA: 'A2',
  //           'ManyOne-LinkB': { id: 'B2', title: 'B2' },
  //           '__fk_ManyOne-LinkB': 'B2',
  //         },
  //       },
  //       tableB: {
  //         B1: {
  //           fieldB: 'B1',
  //           'OneMany-LinkA': null,
  //         },
  //         B2: {
  //           fieldB: 'B2',
  //           'OneMany-LinkA': [
  //             { id: 'A1', title: 'A1' },
  //             { id: 'A2', title: 'A2' },
  //           ],
  //         },
  //       },
  //     });
  //   });
  // });
});
