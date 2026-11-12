/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  FieldType,
  Relationship,
  ViewType,
  generateWorkflowId,
  getRandomString,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IPasteByIdVo } from '@teable/openapi';
import {
  axios,
  PASTE_BY_ID_URL,
  X_CANARY_HEADER,
  urlBuilder,
  undo,
  redo,
  ensureUndoRedoWindowIdHeader,
} from '@teable/openapi';
import { thresholdConfig } from '../src/configs/threshold.config';
import { FieldCreatingService } from '../src/features/field/field-calculate/field-creating.service';
import {
  createField,
  createTable,
  createView,
  getFields,
  getRecord,
  getView,
  initApp,
  permanentDeleteTable,
  updateViewColumnMeta,
} from './utils/init-app';

describe('Selection paste-by-id field expansion (v2, non-stream HTTP)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  const pasteById = (tableId: string, body: unknown, useV2 = true) =>
    axios.patch<IPasteByIdVo>(urlBuilder(PASTE_BY_ID_URL, { tableId }), body, {
      headers: { [X_CANARY_HEADER]: useV2 ? 'true' : 'false' },
      validateStatus: () => true,
    });

  const hideFieldInView = async (tableId: string, viewId: string, fieldId: string) => {
    await updateViewColumnMeta(tableId, viewId, [{ fieldId, columnMeta: { hidden: true } }]);
  };

  it('expands through public v2 HTTP after the legacy field expander is unavailable, preserving ids and live-view order', async () => {
    const target = await createTable(baseId, {
      name: 'paste-by-id-v2-retirement-tracer',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Tail', type: FieldType.SingleLineText },
      ],
      records: [{ fields: { Name: 'before', Tail: 'tail' } }],
    });
    const secondView = await createView(target.id, {
      name: 'Second live view',
      type: ViewType.Grid,
    });
    const [nameField, tailField] = target.fields;
    await hideFieldInView(target.id, target.views[0].id, tailField.id);
    await hideFieldInView(target.id, secondView.id, tailField.id);

    const fieldCreatingService = app.get(FieldCreatingService) as unknown as {
      alterCreateFieldsInExistingTable: (...args: unknown[]) => Promise<unknown>;
    };
    const legacyExpander = fieldCreatingService.alterCreateFieldsInExistingTable;

    try {
      Object.defineProperty(fieldCreatingService, 'alterCreateFieldsInExistingTable', {
        configurable: true,
        writable: true,
        value: undefined,
      });

      const v2Response = await pasteById(target.id, {
        viewId: target.views[0].id,
        selection: { recordIds: [target.records[0].id], fieldIds: [nameField.id, tailField.id] },
        content: [['after', 'tail-after', 'expanded']],
        header: [nameField, tailField, { ...tailField, name: 'Expanded' }],
      });

      expect(v2Response.status).toBe(200);
      expect(v2Response.headers['x-teable-v2']).toBe('true');
      expect(v2Response.data.createdFieldIds).toHaveLength(1);
      expect(v2Response.data.pastedFieldIds).toEqual([
        nameField.id,
        tailField.id,
        ...(v2Response.data.createdFieldIds ?? []),
      ]);

      const createdFieldId = v2Response.data.createdFieldIds![0];
      const record = await getRecord(target.id, target.records[0].id);
      expect(record.fields[nameField.id]).toBe('after');
      expect(record.fields[tailField.id]).toBe('tail-after');
      expect(record.fields[createdFieldId]).toBe('expanded');

      for (const viewId of [target.views[0].id, secondView.id]) {
        const view = await getView(target.id, viewId);
        expect(view.columnMeta[tailField.id]?.hidden).toBe(true);
        expect(view.columnMeta[createdFieldId]?.order).toBeGreaterThan(
          view.columnMeta[tailField.id]?.order ?? -1
        );
        expect(
          (await getFields(target.id, viewId, true)).some((field) => field.id === createdFieldId)
        ).toBe(true);
      }
    } finally {
      Object.defineProperty(fieldCreatingService, 'alterCreateFieldsInExistingTable', {
        configurable: true,
        writable: true,
        value: legacyExpander,
      });
      await permanentDeleteTable(baseId, target.id);
    }

    // The explicit legacy canary remains a control for the retired v2 path.
    const legacyControl = await createTable(baseId, {
      name: 'paste-by-id-v1-control',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'before' } }],
    });
    const previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'false';
    try {
      const response = await pasteById(
        legacyControl.id,
        {
          viewId: legacyControl.views[0].id,
          selection: {
            recordIds: [legacyControl.records[0].id],
            fieldIds: [legacyControl.fields[0].id],
          },
          content: [['after', 'legacy-expanded']],
          header: [
            legacyControl.fields[0],
            { ...legacyControl.fields[0], name: 'Legacy expanded' },
          ],
        },
        false
      );
      expect(response.status).toBe(200);
      expect(response.headers['x-teable-v2']).toBe('false');
      expect(response.data.createdFieldIds).toHaveLength(1);
    } finally {
      if (previousForceV2All === undefined) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
      await permanentDeleteTable(baseId, legacyControl.id);
    }
  });

  it('keeps explicit selection and source-header positions aligned around a pending field', async () => {
    const target = await createTable(baseId, {
      name: 'paste-by-id-v2-pending-position',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Tail', type: FieldType.SingleLineText },
      ],
      records: [{ fields: { Name: 'before', Tail: 'tail' } }],
    });
    const prisma = app.get(PrismaService);
    try {
      const pendingFormula = await createField(target.id, {
        name: 'Pending formula',
        type: FieldType.Formula,
        options: { expression: `{${target.fields[0].id}}` },
      });
      const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
        where: { id: target.id },
        select: { dbTableName: true },
      });
      const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
      const quotedTableName = tableMeta.dbTableName.split('.').map(quoteIdentifier).join('.');
      const quotedFieldName = quoteIdentifier(pendingFormula.dbFieldName);
      await prisma.field.update({ where: { id: pendingFormula.id }, data: { isPending: true } });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${quotedTableName} DROP COLUMN ${quotedFieldName}`
      );

      const [nameField] = target.fields;
      const response = await pasteById(target.id, {
        viewId: target.views[0].id,
        selection: {
          recordIds: [target.records[0].id],
          fieldIds: [nameField.id, pendingFormula.id],
        },
        projection: [nameField.id, pendingFormula.id],
        content: [['updated', 'ignored-pending', 'expanded-after-pending']],
        header: [nameField, pendingFormula, { ...nameField, name: 'Expanded after pending' }],
      });

      expect(response.status).toBe(200);
      expect(response.data.createdFieldIds).toHaveLength(1);
      const createdFieldId = response.data.createdFieldIds![0];
      const record = await getRecord(target.id, target.records[0].id);
      expect(record.fields[nameField.id]).toBe('updated');
      expect(record.fields[pendingFormula.id]).toBeUndefined();
      expect(record.fields[createdFieldId]).toBe('expanded-after-pending');
      expect(response.data.pastedFieldIds).not.toContain(pendingFormula.id);
    } finally {
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it('preserves header type/default metadata while stripping workflow from an expanded button field', async () => {
    const target = await createTable(baseId, {
      name: 'paste-by-id-v2-header-metadata',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'before' } }],
    });
    const source = await createTable(baseId, {
      name: 'paste-by-id-v2-header-source',
      fields: [
        { name: 'Source name', type: FieldType.SingleLineText },
        { name: 'Number source', type: FieldType.Number, options: { defaultValue: 7 } },
        {
          name: 'Button source',
          type: FieldType.Button,
          options: { label: 'Run', color: Colors.Teal, resetCount: true },
        },
      ],
      records: [],
    });
    try {
      const nameField = target.fields[0];
      const sourceNumber = source.fields.find((field) => field.name === 'Number source')!;
      const sourceButton = source.fields.find((field) => field.name === 'Button source')!;
      const copiedButton = {
        ...sourceButton,
        options: {
          ...sourceButton.options,
          workflow: { id: generateWorkflowId(), name: 'Do not copy', isActive: true },
        },
      };
      const response = await pasteById(target.id, {
        viewId: target.views[0].id,
        selection: { recordIds: [target.records[0].id], fieldIds: [nameField.id] },
        content: [['after', 12, '']],
        header: [nameField, sourceNumber, copiedButton],
      });

      expect(response.status).toBe(200);
      expect(response.data.createdFieldIds).toHaveLength(2);
      const fields = await getFields(target.id);
      const [numberId, buttonId] = response.data.createdFieldIds!;
      const createdNumber = fields.find((field) => field.id === numberId)!;
      const createdButton = fields.find((field) => field.id === buttonId)!;
      expect(createdNumber).toMatchObject({ name: 'Number source', type: FieldType.Number });
      expect((createdNumber.options as { defaultValue?: number }).defaultValue).toBe(7);
      expect(createdButton).toMatchObject({ name: 'Button source', type: FieldType.Button });
      expect((createdButton.options as { label?: string; workflow?: unknown }).label).toBe('Run');
      expect((createdButton.options as { workflow?: unknown }).workflow).toBeUndefined();
    } finally {
      await permanentDeleteTable(baseId, target.id);
      await permanentDeleteTable(baseId, source.id);
    }
  });

  it('preserves maxPasteCells failure without creating fields or records', async () => {
    const target = await createTable(baseId, {
      name: 'paste-by-id-v2-quota',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'before' } }],
    });
    const threshold = app.get(thresholdConfig.KEY) as { maxPasteCells: number };
    const previousMaxPasteCells = threshold.maxPasteCells;
    try {
      threshold.maxPasteCells = 2;
      const fieldsBefore = await getFields(target.id);
      const cellsOverLimit = await pasteById(target.id, {
        viewId: target.views[0].id,
        selection: { recordIds: [target.records[0].id], fieldIds: [target.fields[0].id] },
        content: [
          ['a', 'b'],
          ['c', 'd'],
        ],
        header: [target.fields[0], { ...target.fields[0], name: 'Not created' }],
      });
      expect(cellsOverLimit.status).toBe(400);
      expect(await getFields(target.id)).toHaveLength(fieldsBefore.length);
      expect((await getRecord(target.id, target.records[0].id)).fields[target.fields[0].id]).toBe(
        'before'
      );
    } finally {
      threshold.maxPasteCells = previousMaxPasteCells;
      await permanentDeleteTable(baseId, target.id);
    }
  });

  it.each([false, true])(
    'preserves source and reciprocal view placement (useV2=%s)',
    async (useV2) => {
      const target = await createTable(baseId, {
        name: 'A5 reciprocal ordering',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Hidden existing', type: FieldType.SingleLineText },
        ],
        records: [{ fields: { Name: 'Row A', 'Hidden existing': 'keep' } }],
      });
      try {
        const form = await createView(target.id, { name: 'Form', type: ViewType.Form });
        const link = await createField(target.id, {
          name: 'Self link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: target.id,
            lookupFieldId: target.fields[0].id,
            isOneWay: false,
          },
        });
        await hideFieldInView(target.id, target.views[0].id, target.fields[1].id);
        await updateViewColumnMeta(target.id, form.id, [
          { fieldId: target.fields[1].id, columnMeta: { visible: false } },
        ]);
        const previousForceV2 = process.env.FORCE_V2_ALL;
        process.env.FORCE_V2_ALL = 'false';
        const response = await pasteById(
          target.id,
          {
            viewId: target.views[0].id,
            selection: { recordIds: [target.records[0].id], fieldIds: [target.fields[0].id] },
            content: [['Row A', '', 'Expanded text']],
            header: [target.fields[0], link, { ...target.fields[0], name: target.name }],
          },
          useV2
        ).finally(() => {
          if (previousForceV2 === undefined) delete process.env.FORCE_V2_ALL;
          else process.env.FORCE_V2_ALL = previousForceV2;
        });
        expect(response.status, JSON.stringify(response.data)).toBe(200);
        expect(response.headers['x-teable-v2']).toBe(String(useV2));
        const [copiedLinkId, copiedTextId] = response.data.createdFieldIds!;
        const fields = await getFields(target.id);
        const copiedLink = fields.find((field) => field.id === copiedLinkId)!;
        const reciprocalId = (copiedLink.options as { symmetricFieldId: string }).symmetricFieldId;
        expect((await getRecord(target.id, target.records[0].id)).fields[copiedTextId]).toBe(
          'Expanded text'
        );
        for (const viewId of [target.views[0].id, form.id]) {
          const view = await getView(target.id, viewId);
          const visibleFieldIds = new Set(
            (await getFields(target.id, viewId, true)).map((field) => field.id)
          );
          for (const fieldId of [copiedLinkId, copiedTextId, reciprocalId]) {
            expect(
              visibleFieldIds.has(fieldId),
              JSON.stringify({ type: view.type, fieldId, meta: view.columnMeta[fieldId] })
            ).toBe(view.type === ViewType.Grid);
          }
          expect(visibleFieldIds.has(target.fields[1].id)).toBe(false);
          expect(view.columnMeta[copiedLinkId].order).toBeLessThan(
            view.columnMeta[copiedTextId].order
          );
          expect(view.columnMeta[copiedTextId].order).toBeLessThan(
            view.columnMeta[reciprocalId].order
          );
        }
      } finally {
        await permanentDeleteTable(baseId, target.id);
      }
    }
  );

  it('keeps record undo and redo without adding a field-only history entry for expansion', async () => {
    const target = await createTable(baseId, {
      name: 'A5 paste history',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'before' } }],
    });
    const previousWindowId = axios.defaults.headers.common['X-Window-Id'];
    ensureUndoRedoWindowIdHeader('win' + getRandomString(8));
    try {
      const response = await pasteById(target.id, {
        viewId: target.views[0].id,
        selection: { recordIds: [target.records[0].id], fieldIds: [target.fields[0].id] },
        content: [['after', 'expanded']],
      });
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      const newFieldId = response.data.createdFieldIds![0];
      await undo(target.id);
      expect((await getRecord(target.id, target.records[0].id)).fields[target.fields[0].id]).toBe(
        'before'
      );
      await undo(target.id);
      expect((await getFields(target.id)).map((field) => field.id)).toContain(newFieldId);
      await redo(target.id);
      const restored = await getRecord(target.id, target.records[0].id);
      expect(restored.fields[target.fields[0].id]).toBe('after');
      expect(restored.fields[newFieldId]).toBe('expanded');
    } finally {
      if (previousWindowId == null) delete axios.defaults.headers.common['X-Window-Id'];
      else axios.defaults.headers.common['X-Window-Id'] = previousWindowId;
      await permanentDeleteTable(baseId, target.id);
    }
  });
});
