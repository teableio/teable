/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createTableOkResponseSchema,
  deleteFieldOkResponseSchema,
  getTableByIdOkResponseSchema,
  type ITableDto,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http deleteField (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createTable = async (name: string) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name,
        fields: [{ type: 'singleLineText', name: 'Name' }],
      }),
    });

    expect(response.status).toBe(201);
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
    }

    const table = parsed.data.data.table;
    const primaryField = table.fields.find((field) => field.isPrimary);
    if (!primaryField) throw new Error('Missing primary field');

    return { tableId: table.id, primaryFieldId: primaryField.id };
  };

  const getTableById = async (tableId: string): Promise<ITableDto> => {
    const response = await fetch(`${baseUrl}/tables/get?baseId=${baseId}&tableId=${tableId}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const rawBody = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse get table response');
    }

    return parsed.data.data.table;
  };

  const sortedFieldIds = (fields: ITableDto['fields']) => fields.map((field) => field.id).sort();

  beforeAll(async () => {
    const testContainer = await createV2NodeTestContainer();
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
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('deletes a field and returns FieldDeleted events', async () => {
    const { tableId } = await createTable('Delete Field');
    const fieldId = createFieldId();

    const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId,
        field: {
          type: 'singleLineText',
          id: fieldId,
          name: 'Status',
        },
      }),
    });

    expect(createFieldResponse.status).toBe(200);
    const createFieldRaw = await createFieldResponse.json();
    const createFieldParsed = createFieldOkResponseSchema.safeParse(createFieldRaw);
    expect(createFieldParsed.success).toBe(true);
    if (!createFieldParsed.success || !createFieldParsed.data.ok) return;

    const deleteResponse = await fetch(`${baseUrl}/tables/deleteField`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId,
        fieldId,
      }),
    });

    expect(deleteResponse.status).toBe(200);
    const rawBody = await deleteResponse.json();
    const parsed = deleteFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    const body = parsed.data;
    expect(body.data.table.fields.some((field) => field.id === fieldId)).toBe(false);
    expect(body.data.events.some((event) => event.name === 'FieldDeleted')).toBe(true);

    const refreshed = await getTableById(tableId);
    expect(refreshed.fields.some((field) => field.id === fieldId)).toBe(false);
  });

  it('removes symmetric link fields when deleting links', async () => {
    const host = await createTable('Host');
    const foreign = await createTable('Foreign');
    const linkFieldId = createFieldId();

    const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId: host.tableId,
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreign.tableId,
            lookupFieldId: foreign.primaryFieldId,
          },
        },
      }),
    });

    expect(createFieldResponse.status).toBe(200);
    const createFieldRaw = await createFieldResponse.json();
    const createFieldParsed = createFieldOkResponseSchema.safeParse(createFieldRaw);
    expect(createFieldParsed.success).toBe(true);
    if (!createFieldParsed.success || !createFieldParsed.data.ok) return;

    const hostTable = createFieldParsed.data.data.table;
    const linkField = hostTable.fields.find((field) => field.id === linkFieldId);
    expect(linkField?.type).toBe('link');
    if (!linkField || linkField.type !== 'link') return;

    const symmetricFieldId = linkField.options.symmetricFieldId;
    expect(symmetricFieldId).toBeTruthy();
    if (!symmetricFieldId) return;

    const foreignBefore = await getTableById(foreign.tableId);
    expect(foreignBefore.fields.some((field) => field.id === symmetricFieldId)).toBe(true);

    const deleteResponse = await fetch(`${baseUrl}/tables/deleteField`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId: host.tableId,
        fieldId: linkFieldId,
      }),
    });

    const deleteRaw = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    const deleteParsed = deleteFieldOkResponseSchema.safeParse(deleteRaw);
    expect(deleteParsed.success).toBe(true);
    if (!deleteParsed.success || !deleteParsed.data.ok) return;

    const foreignAfter = await getTableById(foreign.tableId);
    expect(foreignAfter.fields.some((field) => field.id === symmetricFieldId)).toBe(false);
  });

  describe('link fields', () => {
    const relationshipCases = [
      { relationship: 'oneOne', symmetricRelationship: 'oneOne' },
      { relationship: 'manyMany', symmetricRelationship: 'manyMany' },
      { relationship: 'oneMany', symmetricRelationship: 'manyOne' },
      { relationship: 'manyOne', symmetricRelationship: 'oneMany' },
    ] as const;

    const directionCases = [
      { isOneWay: false, direction: 'two-way', expectSymmetric: true },
      { isOneWay: true, direction: 'one-way', expectSymmetric: false },
    ] as const;

    const targetCases = [{ target: 'foreign' }, { target: 'self' }] as const;

    const linkCases = targetCases.flatMap((targetCase) =>
      directionCases.flatMap((directionCase) =>
        relationshipCases.map((relationshipCase) => ({
          ...relationshipCase,
          ...directionCase,
          target: targetCase.target,
          caseLabel: `${targetCase.target}-${directionCase.direction}-${relationshipCase.relationship}`,
        }))
      )
    );

    it.each(linkCases)('deletes link fields for $caseLabel', async (entry) => {
      const host = await createTable(`Delete Link Host ${entry.caseLabel}`);
      const foreign =
        entry.target === 'self'
          ? host
          : await createTable(`Delete Link Foreign ${entry.caseLabel}`);
      const linkFieldId = createFieldId();
      const foreignTableId = entry.target === 'self' ? host.tableId : foreign.tableId;
      const lookupFieldId = entry.target === 'self' ? host.primaryFieldId : foreign.primaryFieldId;

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: host.tableId,
          field: {
            type: 'link',
            id: linkFieldId,
            name: `Link ${entry.caseLabel} ${linkFieldId}`,
            options: {
              relationship: entry.relationship,
              foreignTableId,
              lookupFieldId,
              isOneWay: entry.isOneWay,
            },
          },
        }),
      });

      const createFieldRaw = await createFieldResponse.json();
      if (createFieldResponse.status !== 200) {
        throw new Error(`CreateField failed for link: ${JSON.stringify(createFieldRaw)}`);
      }
      expect(createFieldResponse.status).toBe(200);
      const createFieldParsed = createFieldOkResponseSchema.safeParse(createFieldRaw);
      expect(createFieldParsed.success).toBe(true);
      if (!createFieldParsed.success || !createFieldParsed.data.ok) return;

      const hostTable = createFieldParsed.data.data.table;
      const linkField = hostTable.fields.find((field) => field.id === linkFieldId);
      expect(linkField?.type).toBe('link');
      if (!linkField || linkField.type !== 'link') return;
      expect(linkField.options.relationship).toBe(entry.relationship);
      expect(linkField.options.foreignTableId).toBe(foreignTableId);
      expect(linkField.options.lookupFieldId).toBe(lookupFieldId);
      expect(linkField.options.isOneWay ?? false).toBe(entry.isOneWay);

      const hostBefore = await getTableById(host.tableId);
      const targetBefore =
        entry.target === 'self' ? hostBefore : await getTableById(foreign.tableId);
      const symmetricLinksBefore = targetBefore.fields.filter(
        (field) => field.type === 'link' && field.options.symmetricFieldId === linkFieldId
      );

      if (entry.expectSymmetric) {
        expect(symmetricLinksBefore).toHaveLength(1);
      } else {
        expect(symmetricLinksBefore).toHaveLength(0);
      }

      const symmetricFieldId = symmetricLinksBefore[0]?.id;
      const deleteResponse = await fetch(`${baseUrl}/tables/deleteField`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: host.tableId,
          fieldId: linkFieldId,
        }),
      });

      expect(deleteResponse.status).toBe(200);
      const deleteRaw = await deleteResponse.json();
      const deleteParsed = deleteFieldOkResponseSchema.safeParse(deleteRaw);
      expect(deleteParsed.success).toBe(true);
      if (!deleteParsed.success || !deleteParsed.data.ok) return;

      const hostAfter = await getTableById(host.tableId);
      const targetAfter = entry.target === 'self' ? hostAfter : await getTableById(foreign.tableId);
      const removedFieldIds = new Set([linkFieldId]);
      if (symmetricFieldId) removedFieldIds.add(symmetricFieldId);

      const expectedHostAfterIds = sortedFieldIds(hostBefore.fields).filter(
        (fieldId) => !removedFieldIds.has(fieldId)
      );
      const expectedTargetAfterIds = sortedFieldIds(targetBefore.fields).filter(
        (fieldId) => !removedFieldIds.has(fieldId)
      );

      expect(sortedFieldIds(hostAfter.fields)).toEqual(expectedHostAfterIds);
      expect(sortedFieldIds(targetAfter.fields)).toEqual(expectedTargetAfterIds);
      expect(hostAfter.fields.some((field) => field.id === host.primaryFieldId)).toBe(true);
      if (entry.target === 'foreign') {
        expect(targetAfter.fields.some((field) => field.id === foreign.primaryFieldId)).toBe(true);
      }
    });
  });
});
