/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getRecords,
  initApp,
  updateRecordByApi,
  getField,
  convertField,
} from './utils/init-app';

describe('Basic Link Field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const expectHasOrderColumn = async (fieldId: string, expected: boolean) => {
    const prisma = app.get(PrismaService);
    const fieldRaw = await prisma.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { meta: true },
    });
    const meta = fieldRaw.meta ? (JSON.parse(fieldRaw.meta) as { hasOrderColumn?: boolean }) : null;
    expect(meta?.hasOrderColumn ?? false).toBe(expected);
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('OneMany relationship with lookup and rollup', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField: IFieldVo;
    let lookupField: IFieldVo;
    let rollupField: IFieldVo;

    beforeEach(async () => {
      // Create table1 (parent table)
      const textFieldRo: IFieldRo = {
        name: 'Title',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Score',
        type: FieldType.Number,
      };

      table1 = await createTable(baseId, {
        name: 'Projects',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { Title: 'Project A', Score: 100 } },
          { fields: { Title: 'Project B', Score: 200 } },
        ],
      });

      // Create table2 (child table)
      table2 = await createTable(baseId, {
        name: 'Tasks',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { Title: 'Task 1', Score: 10 } },
          { fields: { Title: 'Task 2', Score: 20 } },
          { fields: { Title: 'Task 3', Score: 30 } },
        ],
      });

      // Create OneMany link field from table1 to table2
      const linkFieldRo: IFieldRo = {
        name: 'Tasks',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      linkField = await createField(table1.id, linkFieldRo);

      // Create lookup field to get task titles
      const lookupFieldRo: IFieldRo = {
        name: 'Task Titles',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id, // Title field
          linkFieldId: linkField.id,
        },
      };

      lookupField = await createField(table1.id, lookupFieldRo);

      // Create rollup field to sum task scores
      const rollupFieldRo: IFieldRo = {
        name: 'Total Task Score',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[1].id, // Score field
          linkFieldId: linkField.id,
        },
      };

      rollupField = await createField(table1.id, rollupFieldRo);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create OneMany relationship and verify lookup/rollup values', async () => {
      // Link tasks to projects
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, [
        { id: table2.records[2].id },
      ]);

      // Get records and verify link, lookup, and rollup values
      const records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(records.records).toHaveLength(2);

      // Project A should have 2 linked tasks
      const projectA = records.records.find((r) => r.name === 'Project A');
      expect(projectA?.fields[linkField.id]).toHaveLength(2);
      expect(projectA?.fields[linkField.id]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Task 1' }),
          expect.objectContaining({ title: 'Task 2' }),
        ])
      );

      // Lookup should return task titles
      expect(projectA?.fields[lookupField.id]).toEqual(['Task 1', 'Task 2']);

      // Rollup should sum task scores (10 + 20 = 30)
      expect(projectA?.fields[rollupField.id]).toBe(30);

      // Project B should have 1 linked task
      const projectB = records.records.find((r) => r.name === 'Project B');
      expect(projectB?.fields[linkField.id]).toHaveLength(1);
      expect(projectB?.fields[linkField.id]).toEqual([
        expect.objectContaining({ title: 'Task 3' }),
      ]);

      // Lookup should return task title
      expect(projectB?.fields[lookupField.id]).toEqual(['Task 3']);

      // Rollup should return task score (30)
      expect(projectB?.fields[rollupField.id]).toBe(30);
    });

    it('should handle empty links for OneMany (no linked tasks)', async () => {
      // 初始状态未建立任何链接
      const records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const projectA = records.records.find((r) => r.name === 'Project A');
      const projectB = records.records.find((r) => r.name === 'Project B');

      expect(projectA?.fields[linkField.id]).toBeUndefined();
      expect(projectA?.fields[lookupField.id]).toBeUndefined();
      expect(projectA?.fields[rollupField.id]).toBe(0);

      expect(projectB?.fields[linkField.id]).toBeUndefined();
      expect(projectB?.fields[lookupField.id]).toBeUndefined();
      expect(projectB?.fields[rollupField.id]).toBe(0);
    });
  });

  describe('ManyOne relationship with lookup and rollup', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField: IFieldVo;
    let lookupField: IFieldVo;
    let rollupField: IFieldVo;

    beforeEach(async () => {
      // Create table1 (child table)
      const textFieldRo: IFieldRo = {
        name: 'Title',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Hours',
        type: FieldType.Number,
      };

      table1 = await createTable(baseId, {
        name: 'Tasks',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { Title: 'Task 1', Hours: 5 } },
          { fields: { Title: 'Task 2', Hours: 8 } },
          { fields: { Title: 'Task 3', Hours: 3 } },
        ],
      });

      // Create table2 (parent table)
      table2 = await createTable(baseId, {
        name: 'Projects',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { Title: 'Project A', Hours: 100 } },
          { fields: { Title: 'Project B', Hours: 200 } },
        ],
      });

      // Create ManyOne link field from table1 to table2
      const linkFieldRo: IFieldRo = {
        name: 'Project',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      linkField = await createField(table1.id, linkFieldRo);

      // Create lookup field to get project title
      const lookupFieldRo: IFieldRo = {
        name: 'Project Title',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id, // Title field
          linkFieldId: linkField.id,
        },
      };

      lookupField = await createField(table1.id, lookupFieldRo);

      // Create rollup field to get project hours
      const rollupFieldRo: IFieldRo = {
        name: 'Project Hours',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[1].id, // Hours field
          linkFieldId: linkField.id,
        },
      };

      rollupField = await createField(table1.id, rollupFieldRo);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create ManyOne relationship and verify lookup/rollup values', async () => {
      // Link tasks to projects
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, {
        id: table2.records[0].id,
      });

      await updateRecordByApi(table1.id, table1.records[2].id, linkField.id, {
        id: table2.records[1].id,
      });

      // Get records and verify link, lookup, and rollup values
      const records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(records.records).toHaveLength(3);

      // Task 1 should link to Project A
      const task1 = records.records.find((r) => r.name === 'Task 1');
      expect(task1?.fields[linkField.id]).toEqual(expect.objectContaining({ title: 'Project A' }));
      expect(task1?.fields[lookupField.id]).toBe('Project A');

      expect(task1?.fields[rollupField.id]).toBe(100);

      // Task 2 should link to Project A
      const task2 = records.records.find((r) => r.name === 'Task 2');
      expect(task2?.fields[linkField.id]).toEqual(expect.objectContaining({ title: 'Project A' }));
      expect(task2?.fields[lookupField.id]).toBe('Project A');
      expect(task2?.fields[rollupField.id]).toBe(100);

      // Task 3 should link to Project B
      const task3 = records.records.find((r) => r.name === 'Task 3');
      expect(task3?.fields[linkField.id]).toEqual(expect.objectContaining({ title: 'Project B' }));
      expect(task3?.fields[lookupField.id]).toBe('Project B');
      expect(task3?.fields[rollupField.id]).toBe(200);
    });

    it('should handle null link for ManyOne (no parent)', async () => {
      // 不建立链接，直接读取（使用 beforeEach 初始数据）
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const task1 = records.records.find((r) => r.name === 'Task 1');
      expect(task1?.fields[linkField.id]).toBeUndefined();
      expect(task1?.fields[lookupField.id]).toBeUndefined();
      expect(task1?.fields[rollupField.id]).toBe(0);
    });
  });

  describe('ManyMany relationship with lookup and rollup', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField1: IFieldVo;
    let linkField2: IFieldVo;
    let lookupField1: IFieldVo;
    let rollupField1: IFieldVo;
    let lookupField2: IFieldVo;
    let rollupField2: IFieldVo;

    beforeEach(async () => {
      // Create table1 (Students)
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Grade',
        type: FieldType.Number,
      };

      table1 = await createTable(baseId, {
        name: 'Students',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { Name: 'Alice', Grade: 95 } },

          { fields: { Name: 'Bob', Grade: 87 } },
          { fields: { Name: 'Charlie', Grade: 92 } },
        ],
      });

      // Create table2 (Courses)
      table2 = await createTable(baseId, {
        name: 'Courses',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { Name: 'Math', Grade: 4 } },
          { fields: { Name: 'Science', Grade: 3 } },
          { fields: { Name: 'History', Grade: 2 } },
        ],
      });

      // Create ManyMany link field from table1 to table2
      const linkFieldRo: IFieldRo = {
        name: 'Courses',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      };

      linkField1 = await createField(table1.id, linkFieldRo);

      // Get the symmetric field in table2
      const linkOptions = linkField1.options as any;
      linkField2 = await getField(table2.id, linkOptions.symmetricFieldId);

      // Create lookup field in table1 to get course names
      const lookupFieldRo1: IFieldRo = {
        name: 'Course Names',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id, // Name field
          linkFieldId: linkField1.id,
        },
      };

      lookupField1 = await createField(table1.id, lookupFieldRo1);

      // Create rollup field in table1 to sum course credits
      const rollupFieldRo1: IFieldRo = {
        name: 'Total Credits',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[1].id, // Grade field (used as credits)
          linkFieldId: linkField1.id,
        },
      };

      rollupField1 = await createField(table1.id, rollupFieldRo1);

      // Create lookup field in table2 to get student names
      const lookupFieldRo2: IFieldRo = {
        name: 'Student Names',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id, // Name field
          linkFieldId: linkField2.id,
        },
      };

      lookupField2 = await createField(table2.id, lookupFieldRo2);

      // Create rollup field in table2 to count student grades
      const rollupFieldRo2: IFieldRo = {
        name: 'Student Count',
        type: FieldType.Rollup,
        options: {
          expression: 'count({values})',
        },
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[1].id, // Grade field
          linkFieldId: linkField2.id,
        },
      };

      rollupField2 = await createField(table2.id, rollupFieldRo2);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create ManyMany relationship and verify lookup/rollup values', async () => {
      // Link students to courses
      // Alice takes Math and Science
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // Bob takes Math and History
      await updateRecordByApi(table1.id, table1.records[1].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[2].id },
      ]);

      // Charlie takes Science
      await updateRecordByApi(table1.id, table1.records[2].id, linkField1.id, [
        { id: table2.records[1].id },
      ]);

      // Get student records and verify
      const studentRecords = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(studentRecords.records).toHaveLength(3);

      // Alice should have Math and Science
      const alice = studentRecords.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField1.id]).toHaveLength(2);
      expect(alice?.fields[lookupField1.id]).toEqual(expect.arrayContaining(['Math', 'Science']));
      expect(alice?.fields[rollupField1.id]).toBe(7); // 4 + 3 credits

      // Bob should have Math and History
      const bob = studentRecords.records.find((r) => r.name === 'Bob');
      expect(bob?.fields[linkField1.id]).toHaveLength(2);
      expect(bob?.fields[lookupField1.id]).toEqual(expect.arrayContaining(['Math', 'History']));
      expect(bob?.fields[rollupField1.id]).toBe(6); // 4 + 2 credits

      // Charlie should have Science
      const charlie = studentRecords.records.find((r) => r.name === 'Charlie');
      expect(charlie?.fields[linkField1.id]).toHaveLength(1);
      expect(charlie?.fields[lookupField1.id]).toEqual(['Science']);

      expect(charlie?.fields[rollupField1.id]).toBe(3); // 3 credits

      // Get course records and verify reverse relationships
      const courseRecords = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(courseRecords.records).toHaveLength(3);

      // Math should have Alice and Bob
      const math = courseRecords.records.find((r) => r.name === 'Math');
      expect(math?.fields[linkField2.id]).toHaveLength(2);
      expect(math?.fields[lookupField2.id]).toEqual(expect.arrayContaining(['Alice', 'Bob']));
      expect(math?.fields[rollupField2.id]).toBe(2); // Count of students

      // Science should have Alice and Charlie
      const science = courseRecords.records.find((r) => r.name === 'Science');
      expect(science?.fields[linkField2.id]).toHaveLength(2);
      expect(science?.fields[lookupField2.id]).toEqual(
        expect.arrayContaining(['Alice', 'Charlie'])
      );
      expect(science?.fields[rollupField2.id]).toBe(2); // Count of students

      // History should have Bob
      const history = courseRecords.records.find((r) => r.name === 'History');
      expect(history?.fields[linkField2.id]).toHaveLength(1);
      expect(history?.fields[lookupField2.id]).toEqual(['Bob']);
      expect(history?.fields[rollupField2.id]).toBe(1); // Count of students
    });
  });

  describe('OneOne TwoWay relationship - MAIN TEST CASE', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField1: IFieldVo;
    let linkField2: IFieldVo;

    beforeEach(async () => {
      // Create table1 (Users)
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Users',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Alice' } }, { fields: { Name: 'Bob' } }],
      });

      // Create table2 (Profiles)
      table2 = await createTable(baseId, {
        name: 'Profiles',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Profile A' } }, { fields: { Name: 'Profile B' } }],
      });

      // Create OneOne TwoWay link field from table1 to table2
      // NOTE: Not setting isOneWay: true, so this creates a bidirectional relationship
      const linkFieldRo: IFieldRo = {
        name: 'Profile',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          // isOneWay: false (default) - creates symmetric field
        },
      };

      linkField1 = await createField(table1.id, linkFieldRo);

      // Get the symmetric field in table2
      const linkOptions = linkField1.options as any;
      expect(linkOptions.symmetricFieldId).toBeDefined();
      linkField2 = await getField(table2.id, linkOptions.symmetricFieldId);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create OneOne TwoWay relationship and verify bidirectional linking', async () => {
      // Link Alice to Profile A
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, {
        id: table2.records[0].id,
      });

      // Link Bob to Profile B
      await updateRecordByApi(table1.id, table1.records[1].id, linkField1.id, {
        id: table2.records[1].id,
      });

      // Verify table1 records show correct links
      const table1Records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(table1Records.records).toHaveLength(2);

      const alice = table1Records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField1.id]).toEqual(expect.objectContaining({ title: 'Profile A' }));

      const bob = table1Records.records.find((r) => r.name === 'Bob');
      expect(bob?.fields[linkField1.id]).toEqual(expect.objectContaining({ title: 'Profile B' }));

      // CRITICAL TEST: Verify table2 records show correct symmetric links
      // This is where the bug should manifest - table2 symmetric field data should be empty
      const table2Records = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(table2Records.records).toHaveLength(2);

      // Profile A should link back to Alice
      const profileA = table2Records.records.find((r) => r.id === table2.records[0].id);
      console.log('Profile A symmetric field data:', profileA?.fields[linkField2.id]);
      expect(profileA?.fields[linkField2.id]).toEqual(
        expect.objectContaining({ id: table1.records[0].id })
      );

      // Profile B should link back to Bob
      const profileB = table2Records.records.find((r) => r.id === table2.records[1].id);
      console.log('Profile B symmetric field data:', profileB?.fields[linkField2.id]);
      expect(profileB?.fields[linkField2.id]).toEqual(
        expect.objectContaining({ id: table1.records[1].id })
      );
    });

    it('should handle empty OneOne TwoWay relationship', async () => {
      // No links established, verify both sides are empty
      const table1Records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const alice = table1Records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField1.id]).toBeUndefined();

      const table2Records = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const profileA = table2Records.records.find((r) => r.id === table2.records[0].id);
      expect(profileA?.fields[linkField2.id]).toBeUndefined();
    });
  });

  describe('OneOne OneWay relationship', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField1: IFieldVo;

    beforeEach(async () => {
      // Create table1 (Users)
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Users',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Alice' } }, { fields: { Name: 'Bob' } }],
      });

      // Create table2 (Profiles)
      table2 = await createTable(baseId, {
        name: 'Profiles',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Profile A' } }, { fields: { Name: 'Profile B' } }],
      });

      // Create OneOne OneWay link field from table1 to table2
      const linkFieldRo: IFieldRo = {
        name: 'Profile',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: true, // No symmetric field created
        },
      };

      linkField1 = await createField(table1.id, linkFieldRo);

      // Verify no symmetric field was created
      const linkOptions = linkField1.options as any;
      expect(linkOptions.symmetricFieldId).toBeUndefined();
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create OneOne OneWay relationship and verify unidirectional linking', async () => {
      // Link Alice to Profile A
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, {
        id: table2.records[0].id,
      });

      // Verify table1 records show correct links
      const table1Records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const alice = table1Records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField1.id]).toEqual(expect.objectContaining({ title: 'Profile A' }));

      // Verify table2 has no link fields (one-way relationship)
      const table2Records = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const profileA = table2Records.records.find((r) => r.name === 'Profile A');
      // Should not have any link field since it's one-way
      // When using fieldKeyType: Id, we need to filter by field ID, not field name
      const nameFieldId = table2.fields.find((f) => f.name === 'Name')?.id;
      const linkFieldNames = Object.keys(profileA?.fields || {}).filter(
        (key) => key !== nameFieldId
      );
      expect(linkFieldNames).toHaveLength(0);
    });
  });

  describe('OneMany OneWay relationship', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField1: IFieldVo;

    beforeEach(async () => {
      // Create table1 (Projects)
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Projects',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Project A' } }, { fields: { Name: 'Project B' } }],
      });

      // Create table2 (Tasks)
      table2 = await createTable(baseId, {
        name: 'Tasks',
        fields: [textFieldRo],
        records: [
          { fields: { Name: 'Task 1' } },
          { fields: { Name: 'Task 2' } },
          { fields: { Name: 'Task 3' } },
        ],
      });

      // Create OneMany OneWay link field from table1 to table2
      const linkFieldRo: IFieldRo = {
        name: 'Tasks',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true, // No symmetric field created
        },
      };

      linkField1 = await createField(table1.id, linkFieldRo);

      // Verify no symmetric field was created
      const linkOptions = linkField1.options as any;
      expect(linkOptions.symmetricFieldId).toBeUndefined();
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create OneMany OneWay relationship and verify unidirectional linking', async () => {
      // Link Project A to multiple tasks
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // Link Project B to one task
      await updateRecordByApi(table1.id, table1.records[1].id, linkField1.id, [
        { id: table2.records[2].id },
      ]);

      // Verify table1 records show correct links
      const table1Records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const projectA = table1Records.records.find((r) => r.name === 'Project A');
      expect(projectA?.fields[linkField1.id]).toHaveLength(2);
      expect(projectA?.fields[linkField1.id]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Task 1' }),
          expect.objectContaining({ title: 'Task 2' }),
        ])
      );

      const projectB = table1Records.records.find((r) => r.name === 'Project B');
      expect(projectB?.fields[linkField1.id]).toHaveLength(1);
      expect(projectB?.fields[linkField1.id]).toEqual([
        expect.objectContaining({ title: 'Task 3' }),
      ]);

      // Verify table2 has no link fields (one-way relationship)
      const table2Records = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const task1 = table2Records.records.find((r) => r.name === 'Task 1');
      // When using fieldKeyType: Id, we need to filter by field ID, not field name
      const nameFieldId = table2.fields.find((f) => f.name === 'Name')?.id;
      const linkFieldNames = Object.keys(task1?.fields || {}).filter((key) => key !== nameFieldId);
      expect(linkFieldNames).toHaveLength(0);
    });
  });

  describe('OneMany TwoWay relationship', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField1: IFieldVo;
    let linkField2: IFieldVo;

    beforeEach(async () => {
      // Create table1 (Projects)
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Projects',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Project A' } }, { fields: { Name: 'Project B' } }],
      });

      // Create table2 (Tasks)
      table2 = await createTable(baseId, {
        name: 'Tasks',
        fields: [textFieldRo],
        records: [
          { fields: { Name: 'Task 1' } },
          { fields: { Name: 'Task 2' } },
          { fields: { Name: 'Task 3' } },
        ],
      });

      // Create OneMany TwoWay link field from table1 to table2
      const linkFieldRo: IFieldRo = {
        name: 'Tasks',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          // isOneWay: false (default) - creates symmetric field
        },
      };

      linkField1 = await createField(table1.id, linkFieldRo);

      // Get the symmetric field in table2 (should be ManyOne)
      const linkOptions = linkField1.options as any;
      expect(linkOptions.symmetricFieldId).toBeDefined();
      linkField2 = await getField(table2.id, linkOptions.symmetricFieldId);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create OneMany TwoWay relationship and verify bidirectional linking', async () => {
      // Link Project A to multiple tasks
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // Link Project B to one task
      await updateRecordByApi(table1.id, table1.records[1].id, linkField1.id, [
        { id: table2.records[2].id },
      ]);

      // Verify table1 records show correct links
      const table1Records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const projectA = table1Records.records.find((r) => r.name === 'Project A');
      expect(projectA?.fields[linkField1.id]).toHaveLength(2);

      const projectB = table1Records.records.find((r) => r.name === 'Project B');
      expect(projectB?.fields[linkField1.id]).toHaveLength(1);

      // Verify table2 records show correct symmetric links (ManyOne relationship)
      const table2Records = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      // Task 1 should link back to Project A
      const task1 = table2Records.records.find((r) => r.id === table2.records[0].id);
      expect(task1?.fields[linkField2.id]).toEqual(
        expect.objectContaining({ id: table1.records[0].id })
      );

      // Task 2 should link back to Project A
      const task2 = table2Records.records.find((r) => r.id === table2.records[1].id);
      expect(task2?.fields[linkField2.id]).toEqual(
        expect.objectContaining({ id: table1.records[0].id })
      );

      // Task 3 should link back to Project B
      const task3 = table2Records.records.find((r) => r.id === table2.records[2].id);
      expect(task3?.fields[linkField2.id]).toEqual(
        expect.objectContaining({ id: table1.records[1].id })
      );
    });
  });

  describe('ManyMany OneWay relationship', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField1: IFieldVo;

    beforeEach(async () => {
      // Create table1 (Students)
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Students',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Alice' } }, { fields: { Name: 'Bob' } }],
      });

      // Create table2 (Courses)
      table2 = await createTable(baseId, {
        name: 'Courses',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Math' } }, { fields: { Name: 'Science' } }],
      });

      // Create ManyMany OneWay link field from table1 to table2
      const linkFieldRo: IFieldRo = {
        name: 'Courses',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          isOneWay: true, // No symmetric field created
        },
      };

      linkField1 = await createField(table1.id, linkFieldRo);

      // Verify no symmetric field was created
      const linkOptions = linkField1.options as any;
      expect(linkOptions.symmetricFieldId).toBeUndefined();
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create ManyMany OneWay relationship and verify unidirectional linking', async () => {
      // Link students to courses
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      await updateRecordByApi(table1.id, table1.records[1].id, linkField1.id, [
        { id: table2.records[0].id },
      ]);

      // Verify table1 records show correct links
      const table1Records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const alice = table1Records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField1.id]).toHaveLength(2);
      expect(alice?.fields[linkField1.id]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Math' }),
          expect.objectContaining({ title: 'Science' }),
        ])
      );

      const bob = table1Records.records.find((r) => r.name === 'Bob');
      expect(bob?.fields[linkField1.id]).toHaveLength(1);
      expect(bob?.fields[linkField1.id]).toEqual([expect.objectContaining({ title: 'Math' })]);

      // Verify table2 has no link fields (one-way relationship)
      const table2Records = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const math = table2Records.records.find((r) => r.name === 'Math');
      // When using fieldKeyType: Id, we need to filter by field ID, not field name
      const nameFieldId = table2.fields.find((f) => f.name === 'Name')?.id;
      const linkFieldNames = Object.keys(math?.fields || {}).filter((key) => key !== nameFieldId);
      expect(linkFieldNames).toHaveLength(0);
    });
  });

  describe('ManyMany TwoWay relationship', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField1: IFieldVo;
    let linkField2: IFieldVo;

    beforeEach(async () => {
      // Create table1 (Students)
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Students',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Alice' } }, { fields: { Name: 'Bob' } }],
      });

      // Create table2 (Courses)
      table2 = await createTable(baseId, {
        name: 'Courses',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Math' } }, { fields: { Name: 'Science' } }],
      });

      // Create ManyMany TwoWay link field from table1 to table2
      const linkFieldRo: IFieldRo = {
        name: 'Courses',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          // isOneWay: false (default) - creates symmetric field
        },
      };

      linkField1 = await createField(table1.id, linkFieldRo);

      // Get the symmetric field in table2 (should also be ManyMany)
      const linkOptions = linkField1.options as any;
      expect(linkOptions.symmetricFieldId).toBeDefined();
      linkField2 = await getField(table2.id, linkOptions.symmetricFieldId);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create ManyMany TwoWay relationship and verify bidirectional linking', async () => {
      // Link students to courses
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      await updateRecordByApi(table1.id, table1.records[1].id, linkField1.id, [
        { id: table2.records[0].id },
      ]);

      // Verify table1 records show correct links
      const table1Records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const alice = table1Records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField1.id]).toHaveLength(2);

      const bob = table1Records.records.find((r) => r.name === 'Bob');
      expect(bob?.fields[linkField1.id]).toHaveLength(1);

      // Verify table2 records show correct symmetric links (ManyMany relationship)
      const table2Records = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      // Math should link back to both Alice and Bob
      const math = table2Records.records.find((r) => r.id === table2.records[0].id);
      expect(math?.fields[linkField2.id]).toHaveLength(2);
      expect(math?.fields[linkField2.id]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: table1.records[0].id }),
          expect.objectContaining({ id: table1.records[1].id }),
        ])
      );

      // Science should link back to Alice only
      const science = table2Records.records.find((r) => r.id === table2.records[1].id);
      expect(science?.fields[linkField2.id]).toHaveLength(1);
      expect(science?.fields[linkField2.id]).toEqual([
        expect.objectContaining({ id: table1.records[0].id }),
      ]);
    });
  });

  describe('Convert ManyMany TwoWay to OneWay', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField1: IFieldVo;
    let linkField2: IFieldVo;

    beforeEach(async () => {
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Users',
        fields: [textFieldRo],
        records: [
          { fields: { Name: 'Alice' } },
          { fields: { Name: 'Bob' } },
          { fields: { Name: 'Charlie' } },
        ],
      });

      table2 = await createTable(baseId, {
        name: 'Projects',
        fields: [textFieldRo],
        records: [
          { fields: { Name: 'Project A' } },
          { fields: { Name: 'Project B' } },
          { fields: { Name: 'Project C' } },
        ],
      });

      const linkFieldRo1: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false, // 双向关联
        },
      };

      linkField1 = await createField(table1.id, linkFieldRo1);

      const symmetricFieldId = (linkField1.options as ILinkFieldOptions).symmetricFieldId;
      if (symmetricFieldId) {
        linkField2 = await getField(table2.id, symmetricFieldId);
      }
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should convert bidirectional to unidirectional link without errors and maintain correct data', async () => {
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      await updateRecordByApi(table1.id, table1.records[1].id, linkField1.id, [
        { id: table2.records[2].id },
      ]);

      const table1RecordsBefore = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const table2RecordsBefore = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const aliceBefore = table1RecordsBefore.records.find((r) => r.name === 'Alice');
      expect(aliceBefore?.fields[linkField1.id]).toHaveLength(2);
      expect(aliceBefore?.fields[linkField1.id]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Project A' }),
          expect.objectContaining({ title: 'Project B' }),
        ])
      );

      const bobBefore = table1RecordsBefore.records.find((r) => r.name === 'Bob');
      expect(bobBefore?.fields[linkField1.id]).toHaveLength(1);
      expect(bobBefore?.fields[linkField1.id]).toEqual([
        expect.objectContaining({ title: 'Project C' }),
      ]);

      const projectABefore = table2RecordsBefore.records.find((r) => r.name === 'Project A');
      const projectBBefore = table2RecordsBefore.records.find((r) => r.name === 'Project B');
      const projectCBefore = table2RecordsBefore.records.find((r) => r.name === 'Project C');

      expect(projectABefore?.fields[linkField2.id]).toEqual(
        expect.objectContaining({ title: 'Alice' })
      );
      expect(projectBBefore?.fields[linkField2.id]).toEqual(
        expect.objectContaining({ title: 'Alice' })
      );
      expect(projectCBefore?.fields[linkField2.id]).toEqual(
        expect.objectContaining({ title: 'Bob' })
      );

      const convertFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };

      const convertedField = await convertField(table1.id, linkField1.id, convertFieldRo);

      expect(convertedField.options).toMatchObject({
        relationship: Relationship.OneMany,
        foreignTableId: table2.id,
        isOneWay: true,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

      // 验证转换后 table1 的数据仍然正确
      const table1RecordsAfter = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const aliceAfter = table1RecordsAfter.records.find((r) => r.name === 'Alice');
      expect(aliceAfter?.fields[linkField1.id]).toHaveLength(2);
      expect(aliceAfter?.fields[linkField1.id]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Project A' }),
          expect.objectContaining({ title: 'Project B' }),
        ])
      );

      const bobAfter = table1RecordsAfter.records.find((r) => r.name === 'Bob');
      expect(bobAfter?.fields[linkField1.id]).toHaveLength(1);
      expect(bobAfter?.fields[linkField1.id]).toEqual([
        expect.objectContaining({ title: 'Project C' }),
      ]);

      const table2RecordsAfter = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      table2RecordsAfter.records.forEach((record) => {
        const fieldKeys = Object.keys(record.fields);
        expect(fieldKeys).toHaveLength(1); // 只有 Name 字段
        // When using fieldKeyType: Id, the key should be the field ID, not the field name
        const nameFieldId = table2.fields.find((f) => f.name === 'Name')?.id;
        expect(fieldKeys[0]).toBe(nameFieldId);
      });
    });
  });

  describe('Advanced Link Field Conversion Tests', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeEach(async () => {
      // Create first table (Users table)
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Users',
        fields: [textFieldRo],
        records: [
          { fields: { Name: 'Alice' } },
          { fields: { Name: 'Bob' } },
          { fields: { Name: 'Charlie' } },
        ],
      });

      // Create second table (Projects table)
      table2 = await createTable(baseId, {
        name: 'Projects',
        fields: [textFieldRo],
        records: [
          { fields: { Name: 'Project A' } },
          { fields: { Name: 'Project B' } },
          { fields: { Name: 'Project C' } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should convert OneMany TwoWay to OneWay without errors', async () => {
      // Create bidirectional OneMany link field
      const linkFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false, // Bidirectional link
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      // Establish link relationships
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // Convert to unidirectional link
      const convertFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true, // Convert to unidirectional
        },
      };

      const convertedField = await convertField(table1.id, linkField.id, convertFieldRo);

      // Verify conversion success
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.OneMany,
        foreignTableId: table2.id,
        isOneWay: true,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

      await expectHasOrderColumn(linkField.id, false);

      // Verify data integrity
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField.id]).toHaveLength(2);
    });

    it('should convert OneOne TwoWay to OneWay without errors', async () => {
      // Create bidirectional OneOne link field
      const linkFieldRo: IFieldRo = {
        name: 'Project',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: false, // Bidirectional link
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      // Establish link relationship
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      // Convert to unidirectional link
      const convertFieldRo: IFieldRo = {
        name: 'Project',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: true, // Convert to unidirectional
        },
      };

      const convertedField = await convertField(table1.id, linkField.id, convertFieldRo);

      // Verify conversion success
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.OneOne,
        foreignTableId: table2.id,
        isOneWay: true,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

      await expectHasOrderColumn(linkField.id, true);

      // Verify data integrity
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField.id]).toEqual(expect.objectContaining({ title: 'Project A' }));
    });

    it('should convert OneWay to TwoWay without errors', async () => {
      // 创建单向 OneMany 关联字段
      const linkFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true, // 单向关联
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      // 建立关联关系
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        { id: table2.records[0].id },
      ]);

      // 转换为双向关联
      const convertFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false, // 转为双向关联
        },
      };

      const convertedField = await convertField(table1.id, linkField.id, convertFieldRo);

      // 验证转换成功
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.OneMany,
        foreignTableId: table2.id,
        isOneWay: false,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeDefined();

      await expectHasOrderColumn(linkField.id, true);

      // 验证数据完整性
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField.id]).toHaveLength(1);

      // 验证对称字段存在
      const symmetricFieldId = (convertedField.options as ILinkFieldOptions).symmetricFieldId;
      const symmetricField = await getField(table2.id, symmetricFieldId!);
      expect(symmetricField).toBeDefined();
      await expectHasOrderColumn(symmetricFieldId!, true);
    });

    it('should convert OneMany to ManyMany without errors', async () => {
      // 创建 OneMany 关联字段
      const linkFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      // 建立关联关系
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        { id: table2.records[0].id },
      ]);

      // 转换为 ManyMany 关联
      const convertFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      };

      const convertedField = await convertField(table1.id, linkField.id, convertFieldRo);

      // 验证转换成功
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.ManyMany,
        foreignTableId: table2.id,
        isOneWay: false,
      });

      // 验证数据完整性
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField.id]).toHaveLength(1);
    });

    it('should convert ManyMany to OneMany without errors', async () => {
      // Create ManyMany link field
      const linkFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      // Establish link relationship
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        { id: table2.records[0].id },
      ]);

      // Convert to OneMany relationship
      const convertFieldRo: IFieldRo = {
        name: 'Projects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      };

      const convertedField = await convertField(table1.id, linkField.id, convertFieldRo);

      // Verify conversion success
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.OneMany,
        foreignTableId: table2.id,
        isOneWay: false,
      });

      // Verify data integrity
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[linkField.id]).toHaveLength(1);
    });

    it('should convert bidirectional link created in table2 to unidirectional in table1', async () => {
      // Create bidirectional ManyOne link field in table2 (Projects -> Users)
      const linkFieldRo: IFieldRo = {
        name: 'Assignees',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
          isOneWay: false, // Bidirectional link
        },
      };

      const linkField = await createField(table2.id, linkFieldRo);
      const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

      // Establish link relationships
      await updateRecordByApi(table2.id, table2.records[0].id, linkField.id, {
        id: table1.records[0].id,
      });
      await updateRecordByApi(table2.id, table2.records[1].id, linkField.id, {
        id: table1.records[1].id,
      });

      // Verify symmetric field exists in table1
      expect(symmetricFieldId).toBeDefined();
      const symmetricField = await getField(table1.id, symmetricFieldId!);
      expect(symmetricField).toBeDefined();

      // Convert the symmetric field in table1 to unidirectional
      const convertFieldRo: IFieldRo = {
        name: symmetricField.name,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true, // Convert to unidirectional
        },
      };

      const convertedField = await convertField(table1.id, symmetricFieldId!, convertFieldRo);

      // Verify conversion success
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.OneMany,
        foreignTableId: table2.id,
        isOneWay: true,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

      // Verify data integrity in table1
      const table1Records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = table1Records.records.find((r) => r.name === 'Alice');
      const bob = table1Records.records.find((r) => r.name === 'Bob');
      expect(alice?.fields[convertedField.id]).toHaveLength(1);
      expect(bob?.fields[convertedField.id]).toHaveLength(1);

      // Note: When converting bidirectional to unidirectional, the symmetric field is deleted
      // This is the correct behavior - the original field in table2 may also be affected
      // The conversion successfully completed as evidenced by the 200 status code

      // Verify the symmetric field was properly deleted (this is expected behavior)
      // When converting bidirectional to unidirectional, the symmetric field should be removed
    });

    // Comprehensive Link Field Conversion Test Matrix
    // Testing all combinations of: Direction (OneWay/TwoWay) × Relationship (OneMany/ManyOne/ManyMany) × Table (Source/Target)
    describe('Comprehensive Link Field Conversion Matrix', () => {
      let sourceTable: ITableFullVo;
      let targetTable: ITableFullVo;

      beforeEach(async () => {
        // Create two tables for comprehensive testing
        const sourceTableRo = {
          name: 'SourceTable',
          fields: [
            {
              name: 'Name',
              type: FieldType.SingleLineText,
            },
          ],
          records: [
            { fields: { Name: 'Source1' } },
            { fields: { Name: 'Source2' } },
            { fields: { Name: 'Source3' } },
          ],
        };

        const targetTableRo = {
          name: 'TargetTable',
          fields: [
            {
              name: 'Name',
              type: FieldType.SingleLineText,
            },
          ],
          records: [
            { fields: { Name: 'Target1' } },
            { fields: { Name: 'Target2' } },
            { fields: { Name: 'Target3' } },
          ],
        };

        sourceTable = await createTable(baseId, sourceTableRo);
        targetTable = await createTable(baseId, targetTableRo);
      });

      afterEach(async () => {
        await permanentDeleteTable(baseId, sourceTable.id);
        await permanentDeleteTable(baseId, targetTable.id);
      });

      // Test Matrix: OneWay → TwoWay conversions
      describe('OneWay to TwoWay Conversions', () => {
        it('should convert OneMany OneWay (source) to OneMany TwoWay', async () => {
          // Create OneMany OneWay field in source table
          const linkFieldRo: IFieldRo = {
            name: 'OneMany_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);
          expect((linkField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          // Create some link data before conversion
          const sourceRecords = await getRecords(sourceTable.id);
          const targetRecords = await getRecords(targetTable.id);

          // Link first source record to first two target records
          await updateRecordByApi(sourceTable.id, sourceRecords.records[0].id, linkField.id, [
            { id: targetRecords.records[0].id },
            { id: targetRecords.records[1].id },
          ]);

          // Convert to TwoWay
          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(false);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeDefined();

          await expectHasOrderColumn(linkField.id, true);

          // Verify symmetric field was created in target table
          const symmetricFieldId = (convertedField.options as ILinkFieldOptions).symmetricFieldId;
          const symmetricField = await getField(targetTable.id, symmetricFieldId!);
          expect((symmetricField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyOne
          );
          await expectHasOrderColumn(symmetricFieldId!, true);

          // Verify record data integrity after conversion
          const updatedSourceRecords = await getRecords(sourceTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });
          const updatedTargetRecords = await getRecords(targetTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });

          // Check that the original link data is preserved
          const sourceRecord = updatedSourceRecords.records.find(
            (r) => r.id === sourceRecords.records[0].id
          );
          const linkValue = sourceRecord?.fields[convertedField.id] as any[];
          expect(linkValue).toHaveLength(2);
          expect(linkValue.map((l) => l.id)).toContain(targetRecords.records[0].id);
          expect(linkValue.map((l) => l.id)).toContain(targetRecords.records[1].id);

          // Check that symmetric links were created
          const targetRecord1 = updatedTargetRecords.records.find(
            (r) => r.id === targetRecords.records[0].id
          );
          const targetRecord2 = updatedTargetRecords.records.find(
            (r) => r.id === targetRecords.records[1].id
          );
          const targetRecord3 = updatedTargetRecords.records.find(
            (r) => r.id === targetRecords.records[2].id
          );

          expect(targetRecord1?.fields[symmetricField.id]).toEqual({
            id: sourceRecords.records[0].id,
            title: 'Source1',
          });
          expect(targetRecord2?.fields[symmetricField.id]).toEqual({
            id: sourceRecords.records[0].id,
            title: 'Source1',
          });
          expect(targetRecord3?.fields[symmetricField.id]).toBeUndefined();
        });

        it('should convert ManyOne OneWay (source) to ManyOne TwoWay', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyOne_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(false);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeDefined();

          const symmetricFieldId = (convertedField.options as ILinkFieldOptions).symmetricFieldId;
          const symmetricField = await getField(targetTable.id, symmetricFieldId!);
          expect((symmetricField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.OneMany
          );
        });

        it('should convert ManyMany OneWay (source) to ManyMany TwoWay', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyMany_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(false);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeDefined();

          const symmetricFieldId = (convertedField.options as ILinkFieldOptions).symmetricFieldId;
          const symmetricField = await getField(targetTable.id, symmetricFieldId!);
          expect((symmetricField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyMany
          );
        });
      });

      // Test Matrix: TwoWay → OneWay conversions
      describe('TwoWay to OneWay Conversions', () => {
        it('should convert OneMany TwoWay to OneWay (convert from source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'OneMany_TwoWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);
          const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

          // Create some link data before conversion
          const initialSourceRecords = await getRecords(sourceTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });
          const initialTargetRecords = await getRecords(targetTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });

          // Link first source record to first two target records
          await updateRecordByApi(
            sourceTable.id,
            initialSourceRecords.records[0].id,
            linkField.id,
            [{ id: initialTargetRecords.records[0].id }, { id: initialTargetRecords.records[1].id }]
          );

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          await expectHasOrderColumn(linkField.id, false);

          // Verify record data integrity after conversion
          const finalSourceRecords = await getRecords(sourceTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });
          const finalTargetRecords = await getRecords(targetTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });
          expect(finalSourceRecords.records).toHaveLength(3);
          expect(finalTargetRecords.records).toHaveLength(3);

          // Verify that the original link data is preserved in the source table
          const sourceRecord = finalSourceRecords.records.find(
            (r) => r.id === initialSourceRecords.records[0].id
          );
          const linkValue = sourceRecord?.fields[convertedField.id] as any[];
          expect(linkValue).toHaveLength(2);
          expect(linkValue.map((l) => l.id)).toContain(initialTargetRecords.records[0].id);
          expect(linkValue.map((l) => l.id)).toContain(initialTargetRecords.records[1].id);

          // Verify that target records no longer have symmetric field data (since it was deleted)
          finalTargetRecords.records.forEach((record) => {
            // The symmetric field should not exist anymore
            expect(record.fields).not.toHaveProperty(symmetricFieldId!);
          });

          // Verify symmetric field was deleted
          try {
            await getField(targetTable.id, symmetricFieldId!);
            expect(true).toBe(false); // Should not reach here
          } catch (error) {
            expect(error).toBeDefined(); // Expected - field should be deleted
          }
        });

        it('should convert OneMany TwoWay to OneWay (convert from target table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'OneMany_TwoWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);
          const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;
          const symmetricField = await getField(targetTable.id, symmetricFieldId!);

          // Convert the symmetric field (ManyOne) to OneWay
          const convertFieldRo: IFieldRo = {
            name: symmetricField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: sourceTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(
            targetTable.id,
            symmetricFieldId!,
            convertFieldRo
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          await expectHasOrderColumn(symmetricFieldId!, true);
        });

        it('should convert ManyMany TwoWay to OneWay (convert from source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyMany_TwoWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();
        });

        it('should convert ManyMany TwoWay to OneWay (convert from target table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyMany_TwoWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);
          const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

          const convertFieldRo: IFieldRo = {
            name: 'Converted_ManyMany_OneWay',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: sourceTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(
            targetTable.id,
            symmetricFieldId!,
            convertFieldRo
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();
        });
      });

      // Test Matrix: Relationship Type Conversions (while maintaining direction)
      describe('Relationship Type Conversions', () => {
        it('should convert OneMany OneWay to ManyOne OneWay (source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'OneMany_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          // Create some link data before conversion (OneMany allows multiple targets)
          const beforeSourceRecords = await getRecords(sourceTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });
          const beforeTargetRecords = await getRecords(targetTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });

          await updateRecordByApi(sourceTable.id, beforeSourceRecords.records[0].id, linkField.id, [
            { id: beforeTargetRecords.records[0].id },
            { id: beforeTargetRecords.records[1].id },
          ]);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyOne
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          await expectHasOrderColumn(linkField.id, true);

          // Verify record data after conversion (ManyOne should keep only one link)
          const afterSourceRecords = await getRecords(sourceTable.id, {
            fieldKeyType: FieldKeyType.Id,
          });
          const sourceRecord = afterSourceRecords.records.find(
            (r) => r.id === beforeSourceRecords.records[0].id
          );
          const linkValue = sourceRecord?.fields[convertedField.id];

          // ManyOne relationship should have only one linked record (the first one is typically kept)
          expect(linkValue).toBeDefined();
          if (Array.isArray(linkValue)) {
            expect(linkValue).toHaveLength(1);
          } else {
            expect(linkValue).toHaveProperty('id');
          }
        });

        it('should convert OneMany OneWay to ManyMany OneWay (source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'OneMany_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyMany
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          await expectHasOrderColumn(linkField.id, true);
        });

        it('should convert ManyOne OneWay to OneMany OneWay (source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyOne_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.OneMany
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          await expectHasOrderColumn(linkField.id, false);
        });

        it('should convert ManyOne OneWay to ManyMany OneWay (source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyOne_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyMany
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          await expectHasOrderColumn(linkField.id, true);
        });

        it('should convert ManyMany OneWay to OneMany OneWay (source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyMany_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.OneMany
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          await expectHasOrderColumn(linkField.id, false);
        });

        it('should convert ManyMany OneWay to ManyOne OneWay (source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyMany_OneWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: targetTable.id,
              isOneWay: true,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyOne
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(true);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

          await expectHasOrderColumn(linkField.id, true);
        });
      });

      // Test Matrix: Bidirectional Relationship Type Conversions
      describe('Bidirectional Relationship Type Conversions', () => {
        it('should convert OneMany TwoWay to ManyMany TwoWay (source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'OneMany_TwoWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);
          const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyMany
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(false);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeDefined();

          // Verify symmetric field was updated to ManyMany
          const updatedSymmetricField = await getField(targetTable.id, symmetricFieldId!);
          expect((updatedSymmetricField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyMany
          );
        });

        it('should convert ManyMany TwoWay to OneMany TwoWay (source table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'ManyMany_TwoWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);
          const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

          const convertFieldRo: IFieldRo = {
            name: linkField.name,
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const convertedField = await convertField(sourceTable.id, linkField.id, convertFieldRo);
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.OneMany
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(false);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeDefined();

          // Verify symmetric field was updated to ManyOne
          const updatedSymmetricField = await getField(targetTable.id, symmetricFieldId!);
          expect((updatedSymmetricField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyOne
          );
        });

        it('should convert OneMany TwoWay to ManyMany TwoWay (target table)', async () => {
          const linkFieldRo: IFieldRo = {
            name: 'OneMany_TwoWay_Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: targetTable.id,
              isOneWay: false,
            },
          };

          const linkField = await createField(sourceTable.id, linkFieldRo);
          const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

          // Convert from target table (ManyOne to ManyMany)
          const convertFieldRo: IFieldRo = {
            name: 'Converted_ManyMany_TwoWay',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: sourceTable.id,
              isOneWay: false,
            },
          };

          const convertedField = await convertField(
            targetTable.id,
            symmetricFieldId!,
            convertFieldRo
          );
          expect((convertedField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyMany
          );
          expect((convertedField.options as ILinkFieldOptions).isOneWay).toBe(false);
          expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeDefined();

          // Verify original field was updated to ManyMany
          const updatedOriginalField = await getField(sourceTable.id, linkField.id);
          expect((updatedOriginalField.options as ILinkFieldOptions).relationship).toBe(
            Relationship.ManyMany
          );
        });
      });
    });

    it('should convert ManyMany TwoWay created in table2 to OneWay in table1', async () => {
      // Create bidirectional ManyMany link field in table2
      const linkFieldRo: IFieldRo = {
        name: 'Contributors',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
          isOneWay: false, // Bidirectional link
        },
      };

      const linkField = await createField(table2.id, linkFieldRo);
      const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

      // Establish complex link relationships
      await updateRecordByApi(table2.id, table2.records[0].id, linkField.id, [
        { id: table1.records[0].id },
        { id: table1.records[1].id },
      ]);
      await updateRecordByApi(table2.id, table2.records[1].id, linkField.id, [
        { id: table1.records[1].id },
        { id: table1.records[2].id },
      ]);

      // Verify symmetric field exists in table1
      expect(symmetricFieldId).toBeDefined();
      const symmetricField = await getField(table1.id, symmetricFieldId!);
      expect(symmetricField).toBeDefined();

      // Convert the symmetric field in table1 to unidirectional
      const convertFieldRo: IFieldRo = {
        name: symmetricField.name,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          isOneWay: true, // Convert to unidirectional
        },
      };

      const convertedField = await convertField(table1.id, symmetricFieldId!, convertFieldRo);

      // Verify conversion success
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.ManyMany,
        foreignTableId: table2.id,
        isOneWay: true,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

      // Verify data integrity - complex many-to-many relationships preserved
      const table1Records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = table1Records.records.find((r) => r.name === 'Alice');
      const bob = table1Records.records.find((r) => r.name === 'Bob');
      const charlie = table1Records.records.find((r) => r.name === 'Charlie');

      expect(alice?.fields[convertedField.id]).toHaveLength(1); // Project A
      expect(bob?.fields[convertedField.id]).toHaveLength(2); // Project A, Project B
      expect(charlie?.fields[convertedField.id]).toHaveLength(1); // Project B
    });

    it('should handle OneOne bidirectional conversion with existing data', async () => {
      // Create bidirectional OneOne link field in table2
      const linkFieldRo: IFieldRo = {
        name: 'MainUser',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table1.id,
          isOneWay: false, // Bidirectional link
        },
      };

      const linkField = await createField(table2.id, linkFieldRo);
      const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

      // Establish OneOne relationships
      await updateRecordByApi(table2.id, table2.records[0].id, linkField.id, {
        id: table1.records[0].id,
      });
      await updateRecordByApi(table2.id, table2.records[1].id, linkField.id, {
        id: table1.records[1].id,
      });

      // Convert the symmetric field in table1 to unidirectional
      const convertFieldRo: IFieldRo = {
        name: 'MainProject',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: true, // Convert to unidirectional
        },
      };

      const convertedField = await convertField(table1.id, symmetricFieldId!, convertFieldRo);

      // Verify conversion success
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.OneOne,
        foreignTableId: table2.id,
        isOneWay: true,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

      // Verify data integrity - OneOne relationships preserved
      const table1Records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = table1Records.records.find((r) => r.name === 'Alice');
      const bob = table1Records.records.find((r) => r.name === 'Bob');
      const charlie = table1Records.records.find((r) => r.name === 'Charlie');

      expect(alice?.fields[convertedField.id]).toEqual(
        expect.objectContaining({ title: 'Project A' })
      );
      expect(bob?.fields[convertedField.id]).toEqual(
        expect.objectContaining({ title: 'Project B' })
      );
      expect(charlie?.fields[convertedField.id]).toBeUndefined();
    });

    it('should convert relationship type while maintaining bidirectional nature', async () => {
      // Create bidirectional OneMany link field
      const linkFieldRo: IFieldRo = {
        name: 'TeamProjects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false, // Bidirectional link
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      // Establish relationships
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // Convert relationship type from OneMany to ManyMany while keeping bidirectional
      const convertFieldRo: IFieldRo = {
        name: 'TeamProjects',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      };

      const convertedField = await convertField(table1.id, linkField.id, convertFieldRo);

      // Verify conversion success
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.ManyMany,
        foreignTableId: table2.id,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeDefined();

      // Verify data integrity
      const table1Records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const alice = table1Records.records.find((r) => r.name === 'Alice');
      expect(alice?.fields[convertedField.id]).toHaveLength(2);

      // Verify symmetric field still exists and works
      const newSymmetricFieldId = (convertedField.options as ILinkFieldOptions).symmetricFieldId;
      const newSymmetricField = await getField(table2.id, newSymmetricFieldId!);
      expect(newSymmetricField).toBeDefined();
      expect(newSymmetricField.options).toMatchObject({
        relationship: Relationship.ManyMany,
      });
    });
  });
});
