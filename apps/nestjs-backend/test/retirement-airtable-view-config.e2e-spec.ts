import type { INestApplication } from '@nestjs/common';
import {
  CellValueType,
  FieldType,
  IdPrefix,
  RowHeightLevel,
  ViewType,
  type IViewVo,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IImportAirtableIssue, ITableFullVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { Connection, Doc } from 'sharedb/lib/client';
import { AirtableImportService } from '../src/features/airtable-import/airtable-import.service';
import {
  mapAirtableViewConfig,
  type IMappedViewConfig,
} from '../src/features/airtable-import/airtable-view-config-mapper';
import { BatchService } from '../src/features/calculation/batch.service';
import { ShareDbService } from '../src/share-db/share-db.service';
import type { IClsStore } from '../src/types/cls';
import { failOnRetiredEntry } from './utils/fail-on-retired-entry';
import {
  createTable,
  createView,
  getView,
  initApp,
  permanentDeleteTable,
  runWithTestUser,
} from './utils/init-app';
import { subscribeDocs, waitFor } from './utils/wait';

describe.runIf(process.env.FORCE_V2_ALL === 'true')(
  'A23 Airtable mapped view configuration through native commands and real subscribers',
  () => {
    let app: INestApplication;
    let cookie: string;
    let table: ITableFullVo;
    const baseId = globalThis.testConfig.baseId;

    beforeAll(async () => {
      const context = await initApp();
      app = context.app;
      cookie = context.cookie;
    });

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Airtable mapped native views',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    afterAll(async () => {
      await app.close();
    });

    const subscribe = async (viewId: string) => {
      const connection: Connection = app.get(ShareDbService).connect(undefined, {
        url: `ws://localhost:${process.env.PORT}/socket`,
        headers: { cookie },
      });
      const doc: Doc<IViewVo> = connection.get(`${IdPrefix.View}_${table.id}`, viewId);
      try {
        await subscribeDocs([doc]);
      } catch (error) {
        connection.close();
        throw error;
      }
      const ops: unknown[] = [];
      doc.on('op', (op: unknown) => ops.push(op));
      return { connection, doc, ops };
    };

    const apply = async (
      viewId: string,
      mapped: IMappedViewConfig,
      issues: IImportAirtableIssue[]
    ) =>
      runWithTestUser(app.get<ClsService<IClsStore>>(ClsService), () =>
        app.get(AirtableImportService)['applyMappedViewConfig'](
          {
            airtableViewId: 'viwAirtableFixture',
            teableViewId: viewId,
            teableViewType: ViewType.Grid,
            tableId: table.id,
            tableName: table.name,
            viewName: 'Imported view',
          },
          mapped,
          issues
        )
      );

    it('persists mapped order, visibility, filter, sorting, grouping and options and pushes native ops', async () => {
      const view = await createView(table.id, { type: ViewType.Grid, name: 'Imported view' });
      const [title, amount] = table.fields;
      const issues: IImportAirtableIssue[] = [];
      const mapped = mapAirtableViewConfig({
        teableViewType: ViewType.Grid,
        tableName: table.name,
        viewName: view.name,
        issues,
        ctx: {
          resolveField: (id) =>
            id === 'colTitle'
              ? {
                  fieldId: title.id,
                  type: FieldType.SingleLineText,
                  cellValueType: CellValueType.String,
                  isMultipleCellValue: false,
                }
              : id === 'colAmount'
                ? {
                    fieldId: amount.id,
                    type: FieldType.Number,
                    cellValueType: CellValueType.Number,
                    isMultipleCellValue: false,
                  }
                : undefined,
          resolveSelectOptionName: () => undefined,
        },
        config: {
          columnOrder: [
            { columnId: 'colAmount', visibility: false, width: 141 },
            { columnId: 'colTitle', visibility: true, width: 221 },
          ],
          filters: {
            conjunction: 'and',
            filterSet: [{ columnId: 'colTitle', operator: 'contains', value: 'needle' }],
          },
          sorts: [{ columnId: 'colAmount', ascending: false }],
          groupLevels: [{ columnId: 'colTitle', order: 'ascending' }],
          metadata: undefined,
        },
      });
      // The source fixture controls row height independently of field configuration.
      mapped.options = { rowHeight: RowHeightLevel.Medium };
      const subscriber = await subscribe(view.id);
      const poison = failOnRetiredEntry(
        BatchService.prototype,
        'saveRawOps',
        ([, , docType]) => docType === IdPrefix.View
      );
      try {
        await apply(view.id, mapped, issues);
        expect(issues).toEqual([]);
        await waitFor(() => {
          const options = subscriber.doc.data.options;
          return (
            subscriber.doc.data.columnMeta[amount.id]?.hidden === true &&
            Boolean(
              options && 'rowHeight' in options && options.rowHeight === RowHeightLevel.Medium
            )
          );
        });
        const persisted = await getView(table.id, view.id);
        expect(persisted.columnMeta[amount.id]).toMatchObject({
          order: 0,
          hidden: true,
          width: 141,
        });
        expect(persisted.columnMeta[title.id]).toMatchObject({
          order: 1,
          hidden: false,
          width: 221,
        });
        expect(persisted.filter).toEqual(mapped.filter);
        expect(persisted.sort).toEqual(mapped.sort);
        expect(persisted.group).toEqual(mapped.group);
        expect(persisted.options).toMatchObject(mapped.options!);
        expect(subscriber.doc.data).toMatchObject({
          filter: mapped.filter,
          sort: mapped.sort,
          group: mapped.group,
        });
        expect(subscriber.ops.length).toBeGreaterThanOrEqual(5);
      } finally {
        poison();
        subscriber.connection.close();
      }
    });

    it('reports one rejected native config aspect while retaining successful earlier and later commits', async () => {
      const view = await createView(table.id, {
        type: ViewType.Grid,
        name: 'Partially imported view',
      });
      const fieldId = table.fields[0].id;
      const mapped = {
        columnMeta: [{ fieldId, columnMeta: { order: 0, width: 197 } }],
        filter: {
          conjunction: 'and' as const,
          filterSet: [
            { fieldId: `fld${'z'.repeat(16)}`, operator: 'contains' as const, value: 'missing' },
          ],
        },
        options: { rowHeight: RowHeightLevel.Medium },
      };
      const issues: IImportAirtableIssue[] = [];
      const subscriber = await subscribe(view.id);
      try {
        await apply(view.id, mapped, issues);
        expect(issues).toEqual([
          expect.objectContaining({
            code: 'viewConfigDegraded',
            reason: 'could not apply filters',
          }),
        ]);
        await waitFor(() => {
          const options = subscriber.doc.data.options;
          return Boolean(
            options && 'rowHeight' in options && options.rowHeight === RowHeightLevel.Medium
          );
        });
        const persisted = await getView(table.id, view.id);
        expect(persisted.columnMeta[fieldId].width).toBe(197);
        expect(persisted.filter).toBeUndefined();
        expect(
          (await app.get(PrismaService).view.findUniqueOrThrow({ where: { id: view.id } })).filter
        ).toBeNull();
        expect(persisted.options).toMatchObject({ rowHeight: RowHeightLevel.Medium });
        expect(subscriber.doc.data.columnMeta[fieldId].width).toBe(197);
        expect(subscriber.ops.length).toBeGreaterThanOrEqual(2);
      } finally {
        subscriber.connection.close();
      }
    });
  }
);
