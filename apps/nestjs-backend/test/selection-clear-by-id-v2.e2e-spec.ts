/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue, ILinkFieldOptions } from '@teable/core';
import { Colors, FieldKeyType, FieldType, getRandomString, Relationship } from '@teable/core';
import {
  axios,
  createAxios,
  ensureUndoRedoWindowIdHeader,
  redo,
  undo,
  uploadAttachment,
  X_CANARY_HEADER,
} from '@teable/openapi';
import { SelectionService } from '../src/features/selection/selection.service';
import {
  convertField,
  createField,
  createTable,
  getField,
  getRecord,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
  updateViewColumnMeta,
} from './utils/init-app';

describe('Selection clear-by-id (v2, non-stream HTTP)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  const clearById = (tableId: string, body: unknown, useV2 = true) =>
    axios.patch(`/table/${tableId}/selection/clear-by-id`, body, {
      headers: { [X_CANARY_HEADER]: useV2 ? 'true' : 'false' },
      validateStatus: () => true,
    });

  it('clears through public v2 HTTP after the legacy clear payload builder is unavailable', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-v2-retirement-tracer',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Tail', type: FieldType.SingleLineText },
      ],
      records: [
        { fields: { Name: 'selected', Tail: 'selected-tail' } },
        { fields: { Name: 'retained', Tail: 'retained-tail' } },
      ],
    });
    const [name, tail] = target.fields;
    const [selected, retained] = target.records;
    const selectionService = app.get(SelectionService);
    const legacyBuilder = selectionService.buildClearByIdUpdatePayload;
    let response;
    try {
      // Retire the seam only for the prepared public request, never for fixture creation/readback.
      Object.defineProperty(selectionService, 'buildClearByIdUpdatePayload', {
        configurable: true,
        writable: true,
        value: undefined,
      });
      response = await clearById(target.id, {
        viewId: target.views[0].id,
        selection: { recordIds: [selected.id], fieldIds: [name.id] },
      });
    } finally {
      Object.defineProperty(selectionService, 'buildClearByIdUpdatePayload', {
        configurable: true,
        writable: true,
        value: legacyBuilder,
      });
    }
    try {
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(response.data).toBe('');
      const selectedRecord = await getRecord(target.id, selected.id);
      const retainedRecord = await getRecord(target.id, retained.id);
      expect(selectedRecord.fields[name.id] ?? null).toBeNull();
      expect(selectedRecord.fields[tail.id]).toBe('selected-tail');
      expect(retainedRecord.fields[name.id]).toBe('retained');
      expect(retainedRecord.fields[tail.id]).toBe('retained-tail');
    } finally {
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('keeps an explicit empty record id selection empty rather than clearing the query', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-empty-target',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'first' } }, { fields: { Name: 'second' } }],
    });
    try {
      const response = await clearById(target.id, {
        viewId: target.views[0].id,
        selection: { recordIds: [], fieldIds: [target.fields[0].id] },
      });
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.data).toBe('');
      expect((await getRecord(target.id, target.records[0].id)).fields[target.fields[0].id]).toBe(
        'first'
      );
      expect((await getRecord(target.id, target.records[1].id)).fields[target.fields[0].id]).toBe(
        'second'
      );
    } finally {
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('resolves query targets with exclusions while explicit ids retain their precedence', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-query-scope',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Value', type: FieldType.SingleLineText },
      ],
      records: [
        { fields: { Name: 'match', Value: 'clear' } },
        { fields: { Name: 'match', Value: 'excluded' } },
        { fields: { Name: 'outside', Value: 'explicit' } },
      ],
    });
    const [name, value] = target.fields;
    const filter = {
      conjunction: 'and',
      filterSet: [{ fieldId: name.id, operator: 'is', value: 'match' }],
    };
    try {
      const queryResponse = await clearById(target.id, {
        viewId: target.views[0].id,
        filter,
        selection: { excludeRecordIds: [target.records[1].id], fieldIds: [value.id] },
      });
      expect(queryResponse.status, JSON.stringify(queryResponse.data)).toBe(200);
      expect(queryResponse.data).toBe('');
      expect(
        (await getRecord(target.id, target.records[0].id)).fields[value.id] ?? null
      ).toBeNull();
      expect((await getRecord(target.id, target.records[1].id)).fields[value.id]).toBe('excluded');
      expect((await getRecord(target.id, target.records[2].id)).fields[value.id]).toBe('explicit');

      const explicitResponse = await clearById(target.id, {
        viewId: target.views[0].id,
        filter,
        selection: {
          recordIds: [target.records[2].id],
          fieldIds: [value.id],
        },
      });
      expect(explicitResponse.status, JSON.stringify(explicitResponse.data)).toBe(200);
      expect(
        (await getRecord(target.id, target.records[2].id)).fields[value.id] ?? null
      ).toBeNull();
      expect((await getRecord(target.id, target.records[1].id)).fields[value.id]).toBe('excluded');
    } finally {
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('uses explicit fields before projection and projection before saved hidden-field visibility', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-field-precedence',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Hidden', type: FieldType.SingleLineText },
      ],
      records: [
        { fields: { Name: 'first', Hidden: 'first-hidden' } },
        { fields: { Name: 'second', Hidden: 'second-hidden' } },
        { fields: { Name: 'third', Hidden: 'third-hidden' } },
      ],
    });
    const [name, hidden] = target.fields;
    try {
      await updateViewColumnMeta(target.id, target.views[0].id, [
        { fieldId: hidden.id, columnMeta: { hidden: true } },
      ]);
      const explicit = await clearById(target.id, {
        viewId: target.views[0].id,
        projection: [name.id],
        selection: { recordIds: [target.records[0].id], fieldIds: [hidden.id] },
      });
      expect(explicit.status, JSON.stringify(explicit.data)).toBe(200);
      const projected = await clearById(target.id, {
        viewId: target.views[0].id,
        projection: [hidden.id],
        selection: { recordIds: [target.records[1].id] },
      });
      expect(projected.status, JSON.stringify(projected.data)).toBe(200);
      const visible = await clearById(target.id, {
        viewId: target.views[0].id,
        selection: { recordIds: [target.records[2].id] },
      });
      expect(visible.status, JSON.stringify(visible.data)).toBe(200);
      const first = await getRecord(target.id, target.records[0].id);
      const second = await getRecord(target.id, target.records[1].id);
      const third = await getRecord(target.id, target.records[2].id);
      expect(first.fields[name.id]).toBe('first');
      expect(first.fields[hidden.id] ?? null).toBeNull();
      expect(second.fields[name.id]).toBe('second');
      expect(second.fields[hidden.id] ?? null).toBeNull();
      expect(third.fields[name.id] ?? null).toBeNull();
      expect(third.fields[hidden.id]).toBe('third-hidden');
    } finally {
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('clears typed public cell values while preserving computed cells', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-typed-values',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Number', type: FieldType.Number },
        { name: 'Checked', type: FieldType.Checkbox },
        {
          name: 'Tags',
          type: FieldType.MultipleSelect,
          options: { choices: [{ name: 'A', color: Colors.Blue }] },
        },
        { name: 'Sequence', type: FieldType.AutoNumber },
      ],
      records: [{ fields: { Name: 'before', Number: 12, Checked: true, Tags: ['A'] } }],
    });
    try {
      const formula = await createField(target.id, {
        name: 'Computed',
        type: FieldType.Formula,
        options: { expression: '7' },
      });
      const before = await getRecord(target.id, target.records[0].id);
      const response = await clearById(target.id, {
        viewId: target.views[0].id,
        selection: {
          recordIds: [target.records[0].id],
          fieldIds: [...target.fields.map((field) => field.id), formula.id],
        },
      });
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.data).toBe('');
      const after = await getRecord(target.id, target.records[0].id);
      for (const field of target.fields.slice(0, 4)) {
        expect(after.fields[field.id] ?? null, field.name).toBeNull();
      }
      expect(after.fields[target.fields[4].id]).toBe(before.fields[target.fields[4].id]);
      expect(after.fields[formula.id]).toBe(7);
    } finally {
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('rejects a required-field clear without partially clearing another selected field', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-required',
      fields: [
        { name: 'Required', type: FieldType.SingleLineText },
        { name: 'Other', type: FieldType.SingleLineText },
      ],
      records: [{ fields: { Required: 'required', Other: 'retained' } }],
    });
    try {
      await convertField(target.id, target.fields[0].id, { ...target.fields[0], notNull: true });
      const response = await clearById(target.id, {
        viewId: target.views[0].id,
        selection: {
          recordIds: [target.records[0].id],
          fieldIds: target.fields.map((field) => field.id),
        },
      });
      expect(response.status, JSON.stringify(response.data)).toBeGreaterThanOrEqual(400);
      const record = await getRecord(target.id, target.records[0].id);
      expect(record.fields[target.fields[0].id]).toBe('required');
      expect(record.fields[target.fields[1].id]).toBe('retained');
    } finally {
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('keeps one undoable change across repeated empty-cell and computed-only no-op clears', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-noop-history',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'before' } }],
    });
    const previousWindowId = axios.defaults.headers.common['X-Window-Id'];
    try {
      const formula = await createField(target.id, {
        name: 'Computed',
        type: FieldType.Formula,
        options: { expression: '7' },
      });
      ensureUndoRedoWindowIdHeader('win' + getRandomString(8));
      for (const fieldIds of [[target.fields[0].id], [target.fields[0].id], [formula.id]]) {
        const response = await clearById(target.id, {
          viewId: target.views[0].id,
          selection: { recordIds: [target.records[0].id], fieldIds },
        });
        expect(response.status, JSON.stringify(response.data)).toBe(200);
        expect(response.data).toBe('');
      }
      expect(
        (await getRecord(target.id, target.records[0].id)).fields[target.fields[0].id] ?? null
      ).toBeNull();
      await undo(target.id);
      expect((await getRecord(target.id, target.records[0].id)).fields[target.fields[0].id]).toBe(
        'before'
      );
      await redo(target.id);
      const redone = await getRecord(target.id, target.records[0].id);
      expect(redone.fields[target.fields[0].id] ?? null).toBeNull();
      expect(redone.fields[formula.id]).toBe(7);
    } finally {
      if (previousWindowId == null) delete axios.defaults.headers.common['X-Window-Id'];
      else axios.defaults.headers.common['X-Window-Id'] = previousWindowId;
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('keeps the explicit legacy v1 canary as a public clear control', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-v1-control',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'before' } }],
    });
    const previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'false';
    try {
      const response = await clearById(
        target.id,
        {
          viewId: target.views[0].id,
          selection: { recordIds: [target.records[0].id], fieldIds: [target.fields[0].id] },
        },
        false
      );
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.headers['x-teable-v2']).toBe('false');
      expect(response.data).toBe('');
      expect(
        (await getRecord(target.id, target.records[0].id)).fields[target.fields[0].id] ?? null
      ).toBeNull();
    } finally {
      if (previousForceV2All === undefined) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('clears links and attachment/user/date/rating/select cells while updating inverse links and their count', async () => {
    const foreign = await createTable(baseId, {
      name: 'clear-by-id-typed-link-target',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'linked' } }],
    });
    const target = await createTable(baseId, {
      name: 'clear-by-id-complex-values',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Owner', type: FieldType.User },
        { name: 'Date', type: FieldType.Date },
        {
          name: 'Rating',
          type: FieldType.Rating,
          options: { max: 5, icon: 'star', color: Colors.YellowBright },
        },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: { choices: [{ name: 'Ready', color: Colors.Blue }] },
        },
      ],
      records: ['selected', 'retained'].map((name) => ({
        fields: {
          Name: name,
          Owner: {
            id: globalThis.testConfig.userId,
            title: globalThis.testConfig.userName,
            email: globalThis.testConfig.email,
          },
          Date: '2026-01-02T00:00:00.000Z',
          Rating: 3,
          Status: 'Ready',
        },
      })),
    });
    try {
      const link = await createField(target.id, {
        name: 'Link',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyOne, foreignTableId: foreign.id },
      });
      const inverseId = (link.options as ILinkFieldOptions).symmetricFieldId!;
      const count = await createField(foreign.id, {
        name: 'Linked count',
        type: FieldType.Rollup,
        options: { expression: 'countall({values})' },
        lookupOptions: {
          foreignTableId: target.id,
          linkFieldId: inverseId,
          lookupFieldId: target.fields[0].id,
        },
      });
      const file = await createField(target.id, { name: 'File', type: FieldType.Attachment });
      const contents = Buffer.from('clear-by-id real attachment contents');
      for (const record of target.records) {
        await updateRecordByApi(target.id, record.id, link.id, { id: foreign.records[0].id });
        const uploaded = await uploadAttachment(target.id, record.id, file.id, contents, {
          filename: 'clear-by-id.txt',
          contentType: 'text/plain',
        });
        expect(uploaded.status, JSON.stringify(uploaded.data)).toBe(201);
        expect(uploaded.data.fields[file.id]).toEqual([
          expect.objectContaining({
            id: expect.any(String),
            token: expect.any(String),
            name: 'clear-by-id.txt',
            size: contents.length,
            mimetype: 'text/plain',
          }),
        ]);
      }
      const selectedBefore = await getRecord(target.id, target.records[0].id);
      const retainedBefore = await getRecord(target.id, target.records[1].id);
      expect(selectedBefore.fields[target.fields[1].id]).toMatchObject({
        id: globalThis.testConfig.userId,
      });
      expect(selectedBefore.fields[target.fields[2].id]).toBe('2026-01-02T00:00:00.000Z');
      expect(selectedBefore.fields[target.fields[3].id]).toBe(3);
      expect(selectedBefore.fields[target.fields[4].id]).toBe('Ready');
      expect(selectedBefore.fields[link.id]).toMatchObject({ id: foreign.records[0].id });
      expect((await getRecord(foreign.id, foreign.records[0].id)).fields[count.id]).toBe(2);

      const response = await clearById(target.id, {
        viewId: target.views[0].id,
        selection: {
          recordIds: [target.records[0].id],
          fieldIds: [...target.fields.slice(1).map((field) => field.id), link.id, file.id],
        },
      });
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.data).toBe('');
      const selectedAfter = await getRecord(target.id, target.records[0].id);
      const retainedAfter = await getRecord(target.id, target.records[1].id);
      for (const fieldId of [...target.fields.slice(1).map((field) => field.id), link.id]) {
        expect(selectedAfter.fields[fieldId] ?? null, fieldId).toBeNull();
        expect(retainedAfter.fields[fieldId], fieldId).toEqual(retainedBefore.fields[fieldId]);
      }
      expect(selectedAfter.fields[file.id] ?? null).toBeNull();
      const retainedAttachmentBefore = (retainedBefore.fields[file.id] as IAttachmentCellValue)[0];
      const retainedAttachmentAfter = (retainedAfter.fields[file.id] as IAttachmentCellValue)[0];
      expect(retainedAttachmentAfter).toMatchObject({
        id: retainedAttachmentBefore.id,
        token: retainedAttachmentBefore.token,
        name: 'clear-by-id.txt',
        size: contents.length,
        mimetype: 'text/plain',
      });
      expect(retainedAttachmentAfter.presignedUrl).toEqual(expect.any(String));
      const downloadUrl = new URL(retainedAttachmentAfter.presignedUrl!, axios.defaults.baseURL)
        .href;
      const download = await createAxios().get(downloadUrl, { responseType: 'arraybuffer' });
      expect(download.status).toBe(200);
      expect(Buffer.from(download.data)).toEqual(contents);
      expect(selectedAfter.fields[target.fields[0].id]).toBe('selected');
      const foreignAfter = await getRecord(foreign.id, foreign.records[0].id);
      expect(foreignAfter.fields[inverseId]).toEqual([
        expect.objectContaining({ id: target.records[1].id }),
      ]);
      expect(foreignAfter.fields[count.id]).toBe(1);
      expect((await getField(target.id, target.fields[4].id)).options).toEqual(
        target.fields[4].options
      );
    } finally {
      await permanentDeleteTable(baseId, target.id);
      await permanentDeleteTable(baseId, foreign.id);
    }
  });

  it('undoes and redoes a non-stream clear spanning the 500-record native update batch boundary', async () => {
    const target = await createTable(baseId, {
      name: 'clear-by-id-multibatch-history',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      // Native table.updateRecordsStream caps a narrow table batch at 500 records.
      records: Array.from({ length: 502 }, (_, index) => ({ fields: { Name: `row-${index}` } })),
    });
    const previousWindowId = axios.defaults.headers.common['X-Window-Id'];
    const fieldId = target.fields[0].id;
    const selected = target.records.slice(0, 501);
    const retained = target.records[501];
    try {
      ensureUndoRedoWindowIdHeader('win' + getRandomString(8));
      const response = await clearById(target.id, {
        viewId: target.views[0].id,
        selection: { recordIds: selected.map((record) => record.id), fieldIds: [fieldId] },
      });
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.data).toBe('');
      const cleared = await getRecords(target.id, { take: 1000, fieldKeyType: FieldKeyType.Id });
      expect(cleared.records).toHaveLength(502);
      const clearedById = new Map(cleared.records.map((record) => [record.id, record.fields]));
      for (const record of selected) {
        expect(clearedById.get(record.id)?.[fieldId] ?? null, record.id).toBeNull();
      }
      expect(clearedById.get(retained.id)?.[fieldId]).toBe('row-501');

      await undo(target.id);
      const restored = await getRecords(target.id, { take: 1000, fieldKeyType: FieldKeyType.Id });
      expect(restored.records).toHaveLength(502);
      const restoredById = new Map(restored.records.map((record) => [record.id, record.fields]));
      for (const [index, record] of target.records.entries()) {
        expect(restoredById.get(record.id)?.[fieldId], record.id).toBe(`row-${index}`);
      }

      await redo(target.id);
      const redone = await getRecords(target.id, { take: 1000, fieldKeyType: FieldKeyType.Id });
      expect(redone.records).toHaveLength(502);
      const redoneById = new Map(redone.records.map((record) => [record.id, record.fields]));
      for (const record of selected) {
        expect(redoneById.get(record.id)?.[fieldId] ?? null, record.id).toBeNull();
      }
      expect(redoneById.get(retained.id)?.[fieldId]).toBe('row-501');
    } finally {
      if (previousWindowId == null) delete axios.defaults.headers.common['X-Window-Id'];
      else axios.defaults.headers.common['X-Window-Id'] = previousWindowId;
      await permanentDeleteTable(baseId, target.id);
    }
  });
});
