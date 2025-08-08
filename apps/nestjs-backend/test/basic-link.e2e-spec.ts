/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getRecords,
  initApp,
  updateRecordByApi,
  getField,
} from './utils/init-app';

describe('Basic Link Field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

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
        fieldKeyType: FieldKeyType.Name,
      });

      expect(records.records).toHaveLength(2);

      // Project A should have 2 linked tasks
      const projectA = records.records.find((r) => r.fields.Title === 'Project A');
      expect(projectA?.fields[linkField.name]).toHaveLength(2);
      expect(projectA?.fields[linkField.name]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Task 1' }),
          expect.objectContaining({ title: 'Task 2' }),
        ])
      );

      // Lookup should return task titles
      expect(projectA?.fields[lookupField.name]).toEqual(['Task 1', 'Task 2']);

      // Rollup should sum task scores (10 + 20 = 30)
      expect(projectA?.fields[rollupField.name]).toBe(30);

      // Project B should have 1 linked task
      const projectB = records.records.find((r) => r.fields.Title === 'Project B');
      expect(projectB?.fields[linkField.name]).toHaveLength(1);
      expect(projectB?.fields[linkField.name]).toEqual([
        expect.objectContaining({ title: 'Task 3' }),
      ]);

      // Lookup should return task title
      expect(projectB?.fields[lookupField.name]).toEqual(['Task 3']);

      // Rollup should return task score (30)
      expect(projectB?.fields[rollupField.name]).toBe(30);
    });

    it('should handle empty links for OneMany (no linked tasks)', async () => {
      // 初始状态未建立任何链接
      const records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      const projectA = records.records.find((r) => r.fields.Title === 'Project A');
      const projectB = records.records.find((r) => r.fields.Title === 'Project B');

      expect(projectA?.fields[linkField.name]).toEqual([]);
      expect(projectA?.fields[lookupField.name]).toBeUndefined();
      expect(projectA?.fields[rollupField.name]).toBeUndefined();

      expect(projectB?.fields[linkField.name]).toEqual([]);
      expect(projectB?.fields[lookupField.name]).toBeUndefined();
      expect(projectB?.fields[rollupField.name]).toBeUndefined();
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
        fieldKeyType: FieldKeyType.Name,
      });

      expect(records.records).toHaveLength(3);

      // Task 1 should link to Project A
      const task1 = records.records.find((r) => r.fields.Title === 'Task 1');
      expect(task1?.fields[linkField.name]).toEqual(
        expect.objectContaining({ title: 'Project A' })
      );
      expect(task1?.fields[lookupField.name]).toBe('Project A');

      expect(task1?.fields[rollupField.name]).toBe(100);

      // Task 2 should link to Project A
      const task2 = records.records.find((r) => r.fields.Title === 'Task 2');
      expect(task2?.fields[linkField.name]).toEqual(
        expect.objectContaining({ title: 'Project A' })
      );
      expect(task2?.fields[lookupField.name]).toBe('Project A');
      expect(task2?.fields[rollupField.name]).toBe(100);

      // Task 3 should link to Project B
      const task3 = records.records.find((r) => r.fields.Title === 'Task 3');
      expect(task3?.fields[linkField.name]).toEqual(
        expect.objectContaining({ title: 'Project B' })
      );
      expect(task3?.fields[lookupField.name]).toBe('Project B');
      expect(task3?.fields[rollupField.name]).toBe(200);
    });

    it('should handle null link for ManyOne (no parent)', async () => {
      // 不建立链接，直接读取（使用 beforeEach 初始数据）
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Name });
      const task1 = records.records.find((r) => r.fields.Title === 'Task 1');
      expect(task1?.fields[linkField.name]).toBeUndefined();
      expect(task1?.fields[lookupField.name]).toBeUndefined();
      expect(task1?.fields[rollupField.name]).toBeUndefined();
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
        fieldKeyType: FieldKeyType.Name,
      });

      expect(studentRecords.records).toHaveLength(3);

      // Alice should have Math and Science
      const alice = studentRecords.records.find((r) => r.fields.Name === 'Alice');
      expect(alice?.fields[linkField1.name]).toHaveLength(2);
      expect(alice?.fields[lookupField1.name]).toEqual(expect.arrayContaining(['Math', 'Science']));
      expect(alice?.fields[rollupField1.name]).toBe(7); // 4 + 3 credits

      // Bob should have Math and History
      const bob = studentRecords.records.find((r) => r.fields.Name === 'Bob');
      expect(bob?.fields[linkField1.name]).toHaveLength(2);
      expect(bob?.fields[lookupField1.name]).toEqual(expect.arrayContaining(['Math', 'History']));
      expect(bob?.fields[rollupField1.name]).toBe(6); // 4 + 2 credits

      // Charlie should have Science
      const charlie = studentRecords.records.find((r) => r.fields.Name === 'Charlie');
      expect(charlie?.fields[linkField1.name]).toHaveLength(1);
      expect(charlie?.fields[lookupField1.name]).toEqual(['Science']);

      expect(charlie?.fields[rollupField1.name]).toBe(3); // 3 credits

      // Get course records and verify reverse relationships
      const courseRecords = await getRecords(table2.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      expect(courseRecords.records).toHaveLength(3);

      // Math should have Alice and Bob
      const math = courseRecords.records.find((r) => r.fields.Name === 'Math');
      expect(math?.fields[linkField2.name]).toHaveLength(2);
      expect(math?.fields[lookupField2.name]).toEqual(expect.arrayContaining(['Alice', 'Bob']));
      expect(math?.fields[rollupField2.name]).toBe(2); // Count of students

      // Science should have Alice and Charlie
      const science = courseRecords.records.find((r) => r.fields.Name === 'Science');
      expect(science?.fields[linkField2.name]).toHaveLength(2);
      expect(science?.fields[lookupField2.name]).toEqual(
        expect.arrayContaining(['Alice', 'Charlie'])
      );
      expect(science?.fields[rollupField2.name]).toBe(2); // Count of students

      // History should have Bob
      const history = courseRecords.records.find((r) => r.fields.Name === 'History');
      expect(history?.fields[linkField2.name]).toHaveLength(1);
      expect(history?.fields[lookupField2.name]).toEqual(['Bob']);
      expect(history?.fields[rollupField2.name]).toBe(1); // Count of students
    });
  });

  describe('ManyMany relationship basic test', () => {
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
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create ManyMany relationship and verify basic linking', async () => {
      // Link students to courses
      // Alice takes Math and Science
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // Bob takes Math
      await updateRecordByApi(table1.id, table1.records[1].id, linkField1.id, [
        { id: table2.records[0].id },
      ]);

      // Get student records and verify
      const studentRecords = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      expect(studentRecords.records).toHaveLength(2);

      // Alice should have Math and Science
      const alice = studentRecords.records.find((r) => r.fields.Name === 'Alice');
      expect(alice?.fields[linkField1.name]).toHaveLength(2);
      expect(alice?.fields[linkField1.name]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Math' }),
          expect.objectContaining({ title: 'Science' }),
        ])
      );

      // Bob should have Math
      const bob = studentRecords.records.find((r) => r.fields.Name === 'Bob');
      expect(bob?.fields[linkField1.name]).toHaveLength(1);
      expect(bob?.fields[linkField1.name]).toEqual([expect.objectContaining({ title: 'Math' })]);
    });
  });
});
