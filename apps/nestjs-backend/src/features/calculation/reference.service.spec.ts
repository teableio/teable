/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType, Relationship } from '@teable-group/core';
import type { Knex } from 'knex';
import knex from 'knex';
import { PrismaService } from '../../prisma.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRo } from '../field/model/factory';
import { ReferenceService } from './reference.service';

describe('ReferenceService', () => {
  let service: ReferenceService;
  let prisma: PrismaService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let initialReferences: any;
  let db: ReturnType<typeof knex>;
  const s = JSON.stringify;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReferenceService, PrismaService],
    }).compile();

    service = module.get<ReferenceService>(ReferenceService);
    prisma = module.get<PrismaService>(PrismaService);
    db = knex({
      client: 'sqlite3',
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function executeKnex(builder: Knex.SchemaBuilder | Knex.QueryBuilder) {
    const sql = builder.toSQL();
    if (Array.isArray(sql)) {
      for (const item of sql) {
        await prisma.$executeRawUnsafe(item.sql, ...item.bindings);
      }
    } else {
      const nativeSql = sql.toNative();
      await prisma.$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
    }
  }

  beforeEach(async () => {
    // create tables
    await executeKnex(
      db.schema.createTable('A', (table) => {
        table.string('__id').primary();
        table.string('fieldA');
        table.string('oneToManyB');
      })
    );
    await executeKnex(
      db.schema.createTable('B', (table) => {
        table.string('__id').primary();
        table.string('fieldB');
        table.string('manyToOneA');
        table.string('__fk_manyToOneA');
        table.string('oneToManyC');
      })
    );
    await executeKnex(
      db.schema.createTable('C', (table) => {
        table.string('__id').primary();
        table.string('fieldC');
        table.string('manyToOneB');
        table.string('__fk_manyToOneB');
      })
    );

    initialReferences = [
      { fromFieldId: 'f1', toFieldId: 'f2' },
      { fromFieldId: 'f2', toFieldId: 'f3' },
      { fromFieldId: 'f2', toFieldId: 'f4' },
      { fromFieldId: 'f3', toFieldId: 'f6' },
      { fromFieldId: 'f5', toFieldId: 'f4' },
      { fromFieldId: 'f7', toFieldId: 'f8' },
    ];

    for (const data of initialReferences) {
      await prisma.reference.create({
        data,
      });
    }
  });

  afterEach(async () => {
    // Delete test data
    await prisma.nodeValue.deleteMany({});
    await prisma.reference.deleteMany({});
    // delete data
    await executeKnex(db('A').truncate());
    await executeKnex(db('B').truncate());
    await executeKnex(db('C').truncate());
    // delete table
    await executeKnex(db.schema.dropTable('A'));
    await executeKnex(db.schema.dropTable('B'));
    await executeKnex(db.schema.dropTable('C'));
  });

  it('topological order with dependencies:', async () => {
    const graph = [
      { fromFieldId: 'a', toFieldId: 'c' },
      { fromFieldId: 'b', toFieldId: 'c' },
      { fromFieldId: 'c', toFieldId: 'd' },
    ];

    const sortedNodes = service.getTopologicalOrderRecursive('a', graph);

    expect(sortedNodes).toEqual([
      { id: 'a', dependencies: [] },
      { id: 'c', dependencies: ['a', 'b'] },
      { id: 'd', dependencies: ['c'] },
    ]);
  });

  it('many to one link relationship order for getAffectedRecords', async () => {
    // fill data
    await executeKnex(
      db('A').insert([
        { __id: 'idA1', fieldA: 'A1', oneToManyB: s(['B1', 'B2']) },
        { __id: 'idA2', fieldA: 'A2', oneToManyB: s(['B3']) },
      ])
    );
    await executeKnex(
      db('B').insert([
        /* eslint-disable prettier/prettier */
        {
          __id: 'idB1',
          fieldB: 'A1',
          manyToOneA: 'A1',
          __fk_manyToOneA: 'idA1',
          oneToManyC: s(['C1', 'C2']),
        },
        {
          __id: 'idB2',
          fieldB: 'A1',
          manyToOneA: 'A1',
          __fk_manyToOneA: 'idA1',
          oneToManyC: s(['C3']),
        },
        {
          __id: 'idB3',
          fieldB: 'A2',
          manyToOneA: 'A2',
          __fk_manyToOneA: 'idA2',
          oneToManyC: s(['C4']),
        },
        { __id: 'idB4', fieldB: null, manyToOneA: null, __fk_manyToOneA: null, oneToManyC: null },
        /* eslint-enable prettier/prettier */
      ])
    );
    await executeKnex(
      db('C').insert([
        { __id: 'idC1', fieldC: 'C1', manyToOneB: 'A1', __fk_manyToOneB: 'idB1' },
        { __id: 'idC2', fieldC: 'C2', manyToOneB: 'A1', __fk_manyToOneB: 'idB1' },
        { __id: 'idC3', fieldC: 'C3', manyToOneB: 'A1', __fk_manyToOneB: 'idB2' },
        { __id: 'idC4', fieldC: 'C4', manyToOneB: 'A2', __fk_manyToOneB: 'idB3' },
      ])
    );

    const topoOrder = [
      {
        dbTableName: 'B',
        fieldName: 'manyToOneA',
        foreignKeyField: '__fk_manyToOneA',
        relationship: Relationship.ManyOne,
        linkedTable: 'A',
        dependencies: ['fieldA'],
      },
      {
        dbTableName: 'C',
        fieldName: 'manyToOneB',
        foreignKeyField: '__fk_manyToOneB',
        relationship: Relationship.ManyOne,
        linkedTable: 'B',
        dependencies: ['fieldB'],
      },
    ];

    const records = await service.getAffectedRecordItems(prisma, ['idA1'], topoOrder);

    expect(records).toEqual([
      { id: 'idA1', dbTableName: 'A' },
      { id: 'idB1', dbTableName: 'B' },
      { id: 'idB2', dbTableName: 'B' },
      { id: 'idC1', dbTableName: 'C' },
      { id: 'idC2', dbTableName: 'C' },
      { id: 'idC3', dbTableName: 'C' },
    ]);

    const recordsWithMultiInput = await service.getAffectedRecordItems(
      prisma,
      ['idA1', 'idA2'],
      topoOrder
    );

    expect(recordsWithMultiInput).toEqual([
      { id: 'idA1', dbTableName: 'A' },
      { id: 'idA2', dbTableName: 'A' },
      { id: 'idB1', dbTableName: 'B' },
      { id: 'idB2', dbTableName: 'B' },
      { id: 'idB3', dbTableName: 'B' },
      { id: 'idC1', dbTableName: 'C' },
      { id: 'idC2', dbTableName: 'C' },
      { id: 'idC3', dbTableName: 'C' },
      { id: 'idC4', dbTableName: 'C' },
    ]);
  });

  it('one to many link relationship order for getAffectedRecords', async () => {
    await executeKnex(
      db('A').insert([{ __id: 'idA1', fieldA: 'A1', oneToManyB: s(['C1,C2', 'C3']) }])
    );
    await executeKnex(
      db('B').insert([
        /* eslint-disable prettier/prettier */
        {
          __id: 'idB1',
          fieldB: 'C1,C2',
          manyToOneA: 'A1',
          __fk_manyToOneA: 'idA1',
          oneToManyC: s(['C1', 'C2']),
        },
        {
          __id: 'idB2',
          fieldB: 'C3',
          manyToOneA: 'A1',
          __fk_manyToOneA: 'idA1',
          oneToManyC: s(['C3']),
        },
        /* eslint-enable prettier/prettier */
      ])
    );
    await executeKnex(
      db('C').insert([
        { __id: 'idC1', fieldC: 'C1', manyToOneB: 'C1,C2', __fk_manyToOneB: 'idB1' },
        { __id: 'idC2', fieldC: 'C2', manyToOneB: 'C1,C2', __fk_manyToOneB: 'idB1' },
        { __id: 'idC3', fieldC: 'C3', manyToOneB: 'C3', __fk_manyToOneB: 'idB2' },
      ])
    );
    // topoOrder Graph:
    // C.fieldC -> B.oneToManyC -> B.fieldB -> A.oneToManyB
    //                                      -> C.manyToOneB
    const topoOrder = [
      {
        dbTableName: 'B',
        fieldName: 'oneToManyC',
        foreignKeyField: '__fk_manyToOneB',
        relationship: Relationship.OneMany,
        linkedTable: 'C',
      },
      {
        dbTableName: 'A',
        fieldName: 'oneToManyB',
        foreignKeyField: '__fk_manyToOneA',
        relationship: Relationship.OneMany,
        linkedTable: 'B',
      },
      {
        dbTableName: 'C',
        fieldName: 'manyToOneB',
        foreignKeyField: '__fk_manyToOneB',
        relationship: Relationship.ManyOne,
        linkedTable: 'B',
      },
    ];

    const records = await service.getAffectedRecordItems(prisma, ['idC1'], topoOrder);

    // manyToOneB: ['B1', 'B2']
    expect(records).toEqual([
      { id: 'idC1', dbTableName: 'C' },
      { id: 'idB1', dbTableName: 'B', selectIn: 'C.__fk_manyToOneB' },
      { id: 'idA1', dbTableName: 'A', selectIn: 'B.__fk_manyToOneA' },
      { id: 'idC2', dbTableName: 'C' },
    ]);

    const extraRecords = await service.getExtraDependentRecordItems(prisma, records);

    expect(extraRecords).toEqual([
      { id: 'idB1', dbTableName: 'B', belongsTo: 'idA1' },
      { id: 'idB2', dbTableName: 'B', belongsTo: 'idA1' },
      { id: 'idC1', dbTableName: 'C', belongsTo: 'idB1' },
      { id: 'idC2', dbTableName: 'C', belongsTo: 'idB1' },
    ]);
  });

  it('getDependentNodesCTE should return all dependent nodes', async () => {
    const result = await service.getDependentNodesCTE(prisma, 'f2');
    console.log('result:', result);
    const resultData = [...initialReferences];
    resultData.pop();
    expect(result).toEqual(expect.arrayContaining(resultData));
  });

  it.skip('should correctly collect changes for Link and Computed fields', () => {
    // 1. Arrange
    const orders = [
      {
        id: 'field1',
        dependencies: [],
        recordItems: [
          { record: { id: 'record1', fields: { field1: 'oldValue1' }, recordOrder: {} } },
          { record: { id: 'record2', fields: { field1: 'oldValue2' }, recordOrder: {} } },
        ],
      },
      {
        id: 'field2',
        dependencies: ['field1'],
        recordItems: [
          { record: { id: 'record1', fields: { field2: 'oldValue3' }, recordOrder: {} } },
          { record: { id: 'record2', fields: { field2: 'oldValue4' }, recordOrder: {} } },
        ],
      },
    ];
    const fieldMap: { [oneToManyd: string]: IFieldInstance } = {
      field1: createFieldInstanceByRo({
        id: 'field1',
        name: 'field1',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: 'foreignTable1',
          lookupFieldId: 'lookupField1',
          dbForeignKeyName: 'dbForeignKeyName1',
          symmetricFieldId: 'symmetricField1',
        },
      }),
    };
    const fieldId2TableId = {
      field1: 'table1',
      field2: 'table2',
    };

    // 2. Act
    const changes = service.collectChanges(orders, fieldMap, fieldId2TableId);

    // 3. Assert
    expect(changes).toEqual([
      // Expect no changes for field1 since it's not computed
      {
        tableId: 'table2',
        recordId: 'record1',
        fieldId: 'field2',
        oldValue: 'oldValue3',
        newValue: 'oldValue1',
      }, // Assuming the computation is {field1}
      {
        tableId: 'table2',
        recordId: 'record2',
        fieldId: 'field2',
        oldValue: 'oldValue4',
        newValue: 'oldValue2',
      }, // Assuming the computation is {field1}
    ]);
  });
});
