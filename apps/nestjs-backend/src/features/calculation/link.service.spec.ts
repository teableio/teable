/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType, Relationship } from '@teable-group/core';
import type { ICellContext, IRecordMapByTableId, ITinyFieldMapByTableId } from './link.service';
import { LinkService } from './link.service';

describe('LinkService', () => {
  let service: LinkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LinkService],
    }).compile();

    service = module.get<LinkService>(LinkService);
  });

  describe('getCellMutation', () => {
    let fieldMapByTableId: ITinyFieldMapByTableId = {};
    beforeEach(() => {
      fieldMapByTableId = {
        tableA: {
          'ManyOne-LinkB': {
            id: 'ManyOne-LinkB',
            tableId: 'tableA',
            type: FieldType.Link,
            dbFieldName: 'ManyOne-LinkB',
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: 'tableB',
              lookupFieldId: 'primary',
              dbForeignKeyName: '__fk_ManyOne-LinkB',
              symmetricFieldId: 'OneMany-LinkA',
            },
          },
        },
        tableB: {
          'OneMany-LinkA': {
            id: 'OneMany-LinkA',
            tableId: 'tableB',
            type: FieldType.Link,
            dbFieldName: 'OneMany-LinkA',
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: 'tableA',
              lookupFieldId: 'primary',
              dbForeignKeyName: '__fk_ManyOne-LinkB',
              symmetricFieldId: 'ManyOne-LinkB',
            },
          },
        },
      };
    });

    it('should create correct mutation when add or del value for ManyOne field', () => {
      /**
       * test case
       *
       * case 1 Add Link Record From ManyOne link Field
       * TableA: ManyOne-LinkB A1.null -> A1.B1
       * { TableB: { B1: { 'OneMany-LinkA': add: [A1] }} }
       * TableB: OneMany-LinkA B1.null -> B1.push(A1)
       *
       */

      const ctx1: ICellContext[] = [
        {
          id: 'A1',
          fieldId: 'ManyOne-LinkB',
          newValue: { id: 'B1' },
        },
      ];

      const mutation1 = service['getCellMutation']('tableA', fieldMapByTableId, ctx1);
      expect(mutation1).toEqual({
        tableB: { B1: { 'OneMany-LinkA': { add: ['A1'], del: [] } } },
      });

      const recordMapByTableId1: IRecordMapByTableId = {
        tableA: { A1: { 'ManyOne-LinkB': undefined } },
        tableB: { B1: { 'OneMany-LinkA': undefined } },
      };
      const changes1 = service['getCellChangeByMutation'](
        mutation1,
        recordMapByTableId1,
        fieldMapByTableId
      );
      expect(changes1).toEqual([
        {
          tableId: 'tableB',
          recordId: 'B1',
          fieldId: 'OneMany-LinkA',
          oldValue: undefined,
          newValue: [{ id: 'A1' }],
        },
      ]);

      const recordMapByTableId2: IRecordMapByTableId = {
        tableA: { A1: { 'ManyOne-LinkB': undefined } },
        tableB: { B1: { 'OneMany-LinkA': [{ id: 'A2' }] } },
      };
      const changes2 = service['getCellChangeByMutation'](
        mutation1,
        recordMapByTableId2,
        fieldMapByTableId
      );
      expect(changes2).toEqual([
        {
          tableId: 'tableB',
          recordId: 'B1',
          fieldId: 'OneMany-LinkA',
          oldValue: [{ id: 'A2' }],
          newValue: [{ id: 'A2' }, { id: 'A1' }],
        },
      ]);

      const ctx2: ICellContext[] = [
        {
          id: 'A1',
          fieldId: 'ManyOne-LinkB',
          oldValue: { id: 'B1' },
        },
      ];

      expect(service['getCellMutation']('tableA', fieldMapByTableId, ctx2)).toEqual({
        tableB: { B1: { 'OneMany-LinkA': { add: [], del: ['A1'] } } },
      });
    });

    it('should create correct mutation when change value for ManyOne field', async () => {
      /**
       * test case
       *
       * case 2 Change Link Record From ManyOne link Field
       * TableA: ManyOne-LinkB A1.B1 -> A1.B2
       * TableB: OneMany-LinkA B1.(Old) -> B1.pop(A1) | B2.(Old) -> B2.push(A1)
       *
       */
      const ctxs: ICellContext[] = [
        {
          id: 'A1',
          fieldId: 'ManyOne-LinkB',
          newValue: { id: 'B2' },
          oldValue: { id: 'B1' },
        },
      ];

      const mutation1 = service['getCellMutation']('tableA', fieldMapByTableId, ctxs);
      expect(mutation1).toEqual({
        tableB: {
          B1: { 'OneMany-LinkA': { add: [], del: ['A1'] } },
          B2: { 'OneMany-LinkA': { add: ['A1'], del: [] } },
        },
      });

      const recordMapByTableId1: IRecordMapByTableId = {
        tableA: { A1: { 'ManyOne-LinkB': undefined } },
        tableB: {
          B1: { 'OneMany-LinkA': [{ id: 'A1' }] },
          B2: { 'OneMany-LinkA': undefined },
        },
      };
      const changes1 = service['getCellChangeByMutation'](
        mutation1,
        recordMapByTableId1,
        fieldMapByTableId
      );
      expect(changes1).toEqual([
        {
          tableId: 'tableB',
          recordId: 'B2',
          fieldId: 'OneMany-LinkA',
          oldValue: undefined,
          newValue: [{ id: 'A1' }],
        },
        {
          tableId: 'tableB',
          recordId: 'B1',
          fieldId: 'OneMany-LinkA',
          oldValue: [{ id: 'A1' }],
          newValue: undefined,
        },
      ]);

      // Mock Prisma TransactionClient
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prisma: any = {
        $executeRawUnsafe: jest.fn(),
      };
      const tableId2DbTableName = {
        tableA: 'tableA',
        tableB: 'tableB',
      };

      await service['updateForeignKey'](
        prisma,
        'tableA',
        tableId2DbTableName,
        fieldMapByTableId,
        ctxs,
        changes1
      );

      const nativeSql = service['knex']('tableA')
        .update({
          [fieldMapByTableId['tableB']['OneMany-LinkA'].options.dbForeignKeyName]: 'B2',
        })
        .where('__id', 'A1')
        .toSQL()
        .toNative();

      expect(prisma.$executeRawUnsafe).toBeCalledWith(nativeSql.sql, ...nativeSql.bindings);
    });

    it('should create correct mutation when multi mixed change for ManyOne field', () => {
      const ctx2: ICellContext[] = [
        {
          id: 'A1',
          fieldId: 'ManyOne-LinkB',
          newValue: { id: 'B2' },
          oldValue: { id: 'B1' },
        },
        {
          id: 'A2',
          fieldId: 'ManyOne-LinkB',
          newValue: { id: 'B2' },
        },
        {
          id: 'A3',
          fieldId: 'ManyOne-LinkB',
          oldValue: { id: 'B2' },
        },
      ];

      const mutation1 = service['getCellMutation']('tableA', fieldMapByTableId, ctx2);
      expect(mutation1).toEqual({
        tableB: {
          B1: { 'OneMany-LinkA': { add: [], del: ['A1'] } },
          B2: { 'OneMany-LinkA': { add: ['A1', 'A2'], del: ['A3'] } },
        },
      });

      const recordMapByTableId1: IRecordMapByTableId = {
        tableA: {
          A1: { 'ManyOne-LinkB': { id: 'B1' } },
          A2: { 'ManyOne-LinkB': undefined },
          A3: { 'ManyOne-LinkB': { id: 'B2' } },
        },
        tableB: {
          B1: { 'OneMany-LinkA': [{ id: 'A1' }] },
          B2: { 'OneMany-LinkA': [{ id: 'A3' }] },
        },
      };
      const changes1 = service['getCellChangeByMutation'](
        mutation1,
        recordMapByTableId1,
        fieldMapByTableId
      );
      expect(changes1).toEqual([
        {
          tableId: 'tableB',
          recordId: 'B2',
          fieldId: 'OneMany-LinkA',
          oldValue: [{ id: 'A3' }],
          newValue: [{ id: 'A1' }, { id: 'A2' }],
        },
        {
          tableId: 'tableB',
          recordId: 'B1',
          fieldId: 'OneMany-LinkA',
          oldValue: [{ id: 'A1' }],
          newValue: undefined,
        },
      ]);
    });

    it('should create correct mutation when add value for OneMany field', () => {
      /**
       * test case
       *
       * case 3 Add Link Record From OneMany link Field
       * TableA: OneMany-linkB A1.(old) -> A1.push(B1)
       * TableB: ManyOne-LinkA B1.null -> B2.A1
       *
       */
      const ctx: ICellContext[] = [
        { id: 'B1', fieldId: 'OneMany-LinkA', newValue: [{ id: 'A1' }] },
      ];

      const mutation1 = service['getCellMutation']('tableB', fieldMapByTableId, ctx);
      expect(mutation1).toEqual({
        tableA: {
          A1: { 'ManyOne-LinkB': { add: ['B1'], del: [] } },
        },
      });

      const recordMapByTableId1: IRecordMapByTableId = {
        tableA: { A1: { 'ManyOne-LinkB': undefined } },
        tableB: { B1: { 'OneMany-LinkA': undefined } },
      };
      const changes1 = service['getCellChangeByMutation'](
        mutation1,
        recordMapByTableId1,
        fieldMapByTableId
      );
      expect(changes1).toEqual([
        {
          tableId: 'tableA',
          recordId: 'A1',
          fieldId: 'ManyOne-LinkB',
          oldValue: undefined,
          newValue: { id: 'B1' },
        },
      ]);
    });

    it('should create correct mutation when change value for OneMany field', () => {
      /**
       * test case
       *
       * case 4 Change Link Record From OneMany link Field
       * TableA: OneMany-linkB A1.(old) -> A1.[B1]
       * TableB: ManyOne-LinkA B1.null -> B2.A1
       *
       */
      const ctx2: ICellContext[] = [
        {
          id: 'B1',
          fieldId: 'OneMany-LinkA',
          newValue: [{ id: 'A2' }],
          oldValue: [{ id: 'A1' }],
        },
      ];

      const mutation1 = service['getCellMutation']('tableB', fieldMapByTableId, ctx2);
      expect(mutation1).toEqual({
        tableA: {
          A1: { 'ManyOne-LinkB': { add: [], del: ['B1'] } },
          A2: { 'ManyOne-LinkB': { add: ['B1'], del: [] } },
        },
      });

      const recordMapByTableId1: IRecordMapByTableId = {
        tableA: {
          A1: { 'ManyOne-LinkB': { id: 'B1' } },
          A2: { 'ManyOne-LinkB': undefined },
        },
        tableB: { B1: { 'OneMany-LinkA': [{ id: 'A1' }] } },
      };
      const changes1 = service['getCellChangeByMutation'](
        mutation1,
        recordMapByTableId1,
        fieldMapByTableId
      );
      expect(changes1).toEqual([
        {
          tableId: 'tableA',
          recordId: 'A2',
          fieldId: 'ManyOne-LinkB',
          oldValue: undefined,
          newValue: { id: 'B1' },
        },
        {
          tableId: 'tableA',
          recordId: 'A1',
          fieldId: 'ManyOne-LinkB',
          oldValue: { id: 'B1' },
          newValue: undefined,
        },
      ]);
    });

    it('should throw error when add same record for the OneMany field who link to a ManyOne field', () => {
      /**
       * test case
       *
       * case 4 Change Link Record From OneMany link Field
       * TableA: OneMany-linkB A1.(old) -> A1.[B1]
       * TableB: ManyOne-LinkA B1.null -> B2.A1
       *
       */
      const ctx2: ICellContext[] = [
        {
          id: 'B1',
          fieldId: 'OneMany-LinkA',
          newValue: [{ id: 'A2' }],
          oldValue: [{ id: 'A1' }],
        },
        {
          id: 'B2',
          fieldId: 'OneMany-LinkA',
          newValue: [{ id: 'A2' }],
        },
      ];

      const mutation1 = service['getCellMutation']('tableB', fieldMapByTableId, ctx2);
      expect(mutation1).toEqual({
        tableA: {
          A1: { 'ManyOne-LinkB': { add: [], del: ['B1'] } },
          A2: { 'ManyOne-LinkB': { add: ['B1', 'B2'], del: [] } },
        },
      });

      const recordMapByTableId1: IRecordMapByTableId = {
        tableA: {
          A1: { 'ManyOne-LinkB': { id: 'B1' } },
          A2: { 'ManyOne-LinkB': undefined },
        },
        tableB: { B1: { 'OneMany-LinkA': [{ id: 'A1' }] } },
      };
      expect(() =>
        service['getCellChangeByMutation'](mutation1, recordMapByTableId1, fieldMapByTableId)
      ).toThrowError('ManyOne relationship should not have multiple records');
    });
  });
});
