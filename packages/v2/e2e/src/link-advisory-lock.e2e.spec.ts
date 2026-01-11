/* eslint-disable @typescript-eslint/naming-convention */
/**
 * E2E tests for link record advisory locks.
 *
 * These tests verify that advisory locks prevent deadlocks when multiple
 * concurrent transactions operate on link fields pointing to the same
 * foreign record.
 *
 * The deadlock scenario without locks:
 * - Transaction A: DELETE from junction WHERE self=rec1 AND foreign=company1
 * - Transaction B: DELETE from junction WHERE self=rec2 AND foreign=company1
 * - Transaction A: INSERT into junction (self=rec1, foreign=company1)
 * - Transaction B: INSERT into junction (self=rec2, foreign=company1)
 * - Deadlock! Both transactions hold locks on their DELETE and wait for the other's INSERT.
 *
 * With advisory locks:
 * - Both transactions first acquire pg_advisory_xact_lock on the same key
 * - This serializes the operations, preventing deadlock
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('link advisory lock prevents deadlock (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let testContainer: IV2NodeTestContainer;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  // ---------------------------------------------------------------------------
  // API Helpers
  // ---------------------------------------------------------------------------

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
    }
    return parsed.data.data.table;
  };

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create record response');
    }
    return parsed.data.data.record;
  };

  const updateRecord = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse update record response');
    }
    return parsed.data.data.record;
  };

  // ---------------------------------------------------------------------------
  // Setup & Teardown
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
    dispose = testContainer.dispose;
    baseId = testContainer.baseId.toString();

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 120_000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  describe('manyOne relationship', () => {
    it('concurrent inserts linking to same foreign record should not deadlock', async () => {
      // Setup: Create Companies table
      const companyNameFieldId = createFieldId();
      const companiesTable = await createTable({
        baseId,
        name: 'LockTest_Companies',
        fields: [{ type: 'singleLineText', id: companyNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create a single company that all activities will link to
      const company = await createRecord(companiesTable.id, {
        [companyNameFieldId]: 'Acme Corp',
      });

      // Setup: Create Activities table with manyOne link to Companies
      const activityNameFieldId = createFieldId();
      const activityLinkFieldId = createFieldId();
      const activitiesTable = await createTable({
        baseId,
        name: 'LockTest_Activities',
        fields: [
          { type: 'singleLineText', id: activityNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: activityLinkFieldId,
            name: 'Company',
            options: {
              relationship: 'manyOne',
              foreignTableId: companiesTable.id,
              lookupFieldId: companyNameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Concurrent inserts: 10 activities all linking to the same company
      const concurrentCount = 10;
      const insertPromises = Array(concurrentCount)
        .fill(null)
        .map((_, i) =>
          createRecord(activitiesTable.id, {
            [activityNameFieldId]: `Activity${i}`,
            [activityLinkFieldId]: { id: company.id },
          })
        );

      // All should succeed without deadlock
      const results = await Promise.all(insertPromises);

      expect(results).toHaveLength(concurrentCount);
      results.forEach((result, i) => {
        expect(result.id).toBeDefined();
        expect(result.fields[activityNameFieldId]).toBe(`Activity${i}`);
      });
    });
  });

  describe('manyMany relationship', () => {
    it('concurrent inserts with manyMany links to same foreign record should not deadlock', async () => {
      // Setup: Create Tags table
      const tagNameFieldId = createFieldId();
      const tagsTable = await createTable({
        baseId,
        name: 'LockTest_Tags',
        fields: [{ type: 'singleLineText', id: tagNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create tags
      const importantTag = await createRecord(tagsTable.id, { [tagNameFieldId]: 'Important' });
      const urgentTag = await createRecord(tagsTable.id, { [tagNameFieldId]: 'Urgent' });

      // Setup: Create Tasks table with manyMany link to Tags
      const taskNameFieldId = createFieldId();
      const taskTagsFieldId = createFieldId();
      const tasksTable = await createTable({
        baseId,
        name: 'LockTest_Tasks',
        fields: [
          { type: 'singleLineText', id: taskNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: taskTagsFieldId,
            name: 'Tags',
            options: {
              relationship: 'manyMany',
              foreignTableId: tagsTable.id,
              lookupFieldId: tagNameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Concurrent inserts: 10 tasks all linking to the same tags
      const concurrentCount = 10;
      const insertPromises = Array(concurrentCount)
        .fill(null)
        .map((_, i) =>
          createRecord(tasksTable.id, {
            [taskNameFieldId]: `Task${i}`,
            [taskTagsFieldId]: [{ id: importantTag.id }, { id: urgentTag.id }],
          })
        );

      // All should succeed without deadlock
      const results = await Promise.all(insertPromises);

      expect(results).toHaveLength(concurrentCount);
      results.forEach((result) => {
        expect(result.id).toBeDefined();
      });
    });
  });

  describe('concurrent updates', () => {
    it('concurrent updates changing links to same foreign record should not deadlock', async () => {
      // Setup: Create Companies table
      const companyNameFieldId = createFieldId();
      const companiesTable = await createTable({
        baseId,
        name: 'LockTest_Companies2',
        fields: [{ type: 'singleLineText', id: companyNameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create two companies
      const companyA = await createRecord(companiesTable.id, { [companyNameFieldId]: 'Company A' });
      const companyB = await createRecord(companiesTable.id, { [companyNameFieldId]: 'Company B' });

      // Setup: Create Employees table with manyOne link to Companies
      const employeeNameFieldId = createFieldId();
      const employeeLinkFieldId = createFieldId();
      const employeesTable = await createTable({
        baseId,
        name: 'LockTest_Employees',
        fields: [
          { type: 'singleLineText', id: employeeNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: employeeLinkFieldId,
            name: 'Company',
            options: {
              relationship: 'manyOne',
              foreignTableId: companiesTable.id,
              lookupFieldId: companyNameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Create employees linked to Company A
      const concurrentCount = 10;
      const employees = await Promise.all(
        Array(concurrentCount)
          .fill(null)
          .map((_, i) =>
            createRecord(employeesTable.id, {
              [employeeNameFieldId]: `Employee${i}`,
              [employeeLinkFieldId]: { id: companyA.id },
            })
          )
      );

      await testContainer.processOutbox();

      // Concurrent updates: Move all employees from Company A to Company B
      const updatePromises = employees.map((employee) =>
        updateRecord(employeesTable.id, employee.id, {
          [employeeLinkFieldId]: { id: companyB.id },
        })
      );

      // All should succeed without deadlock
      const results = await Promise.all(updatePromises);

      expect(results).toHaveLength(concurrentCount);
      results.forEach((result) => {
        expect(result.id).toBeDefined();
      });
    });
  });
});
