/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship, TableDomain } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import { createFieldInstanceByVo } from '../src/features/field/model/factory';
import {
  initApp,
  createTable,
  createField,
  updateRecordByApi,
  getRecord,
  getTable,
  permanentDeleteTable,
} from './utils/init-app';

describe('Formula notification pipeline (e2e)', () => {
  let app: INestApplication;
  let dbProvider: IDbProvider;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'evaluates notification and sales formulas via lookup metadata',
    async () => {
      let ordersTable: ITableFullVo | undefined;
      let followTable: ITableFullVo | undefined;
      try {
        const createdOrdersTable = await createTable(baseId, {
          name: 'formula_orders_metadata',
          fields: [
            {
              name: 'Initial Payment Status',
              type: FieldType.SingleSelect,
              options: {
                choices: [
                  { name: '已收全款', id: 'full', color: 'greenLight1' },
                  { name: '已收定金', id: 'deposit', color: 'yellowLight2' },
                ],
              },
            },
            {
              name: 'Payment Type',
              type: FieldType.SingleSelect,
              options: {
                choices: [
                  { name: '定金+尾款支付', id: 'once', color: 'grayLight2' },
                  { name: '定金+分2期支付', id: 'p2', color: 'cyanLight2' },
                  { name: '定金+分3期支付', id: 'p3', color: 'cyanLight2' },
                  { name: '定金+分4期支付', id: 'p4', color: 'cyanLight2' },
                  { name: '定金+分期付款', id: 'pX', color: 'cyanLight2' },
                  { name: '全款支付', id: 'full', color: 'greenLight1' },
                ],
              },
            },
            {
              name: 'Full Payment USD',
              type: FieldType.Number,
            },
            {
              name: 'Deposit USD',
              type: FieldType.Number,
            },
          ],
          records: [
            {
              fields: {
                'Initial Payment Status': '已收全款',
                'Payment Type': '全款支付',
                'Full Payment USD': 500,
                'Deposit USD': 0,
              },
            },
            {
              fields: {
                'Initial Payment Status': '已收定金',
                'Payment Type': '定金+分2期支付',
                'Full Payment USD': 1000,
                'Deposit USD': 100,
              },
            },
            {
              fields: {
                'Initial Payment Status': '已收定金',
                'Payment Type': '全款支付',
                'Full Payment USD': 800,
                'Deposit USD': 200,
              },
            },
          ],
        });

        ordersTable = createdOrdersTable;
        const orderFieldsByName = new Map(
          createdOrdersTable.fields.map((field) => [field.name, field])
        );
        const orderRecords = createdOrdersTable.records ?? [];

        const createdFollowTable = await createTable(baseId, {
          name: 'formula_follow_metadata',
          fields: [
            {
              name: '跟进备注(日期+情况说明)',
              type: FieldType.SingleLineText,
            },
          ],
          records: [
            { fields: { '跟进备注(日期+情况说明)': '' } },
            { fields: { '跟进备注(日期+情况说明)': '' } },
            { fields: { '跟进备注(日期+情况说明)': '已提醒一次' } },
          ],
        });

        followTable = createdFollowTable;
        const followFieldsByName = new Map(
          createdFollowTable.fields.map((field) => [field.name, field])
        );
        const followRecords = createdFollowTable.records ?? [];
        const followTableId = createdFollowTable.id;
        const ordersTableId = createdOrdersTable.id;

        if (orderRecords.length < 3 || followRecords.length < 3) {
          throw new Error('Seeded records were not created as expected.');
        }

        // Link to orders table
        const orderLink = await createField(createdFollowTable.id, {
          name: '订单总表',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: ordersTableId,
          },
        });

        const createLookup = async (name: string, type: FieldType, lookupFieldId: string) =>
          createField(createdFollowTable.id, {
            name,
            type,
            isLookup: true,
            lookupOptions: {
              foreignTableId: ordersTableId,
              linkFieldId: orderLink.id,
              lookupFieldId,
            },
          });

        const initialPaymentLookup = await createLookup(
          '初始货款( 从总表查询)',
          FieldType.SingleSelect,
          orderFieldsByName.get('Initial Payment Status')!.id
        );

        const paymentTypeLookup = await createLookup(
          '付款类型(从总表查询)',
          FieldType.SingleSelect,
          orderFieldsByName.get('Payment Type')!.id
        );

        const followRemarkField = followFieldsByName.get('跟进备注(日期+情况说明)')!;

        const buildNotificationExpression = (initialId: string, paymentTypeId: string) =>
          `
IF(
  {${initialId}} = "已收全款",
  "全款-无需补尾款",
  IF(
    AND(
      {${initialId}} = "已收定金",
      OR(
        {${paymentTypeId}} = "定金+分2期支付",
        {${paymentTypeId}} = "定金+分3期支付",
        {${paymentTypeId}} = "定金+分4期支付",
        {${paymentTypeId}} = "定金+分期付款"
      )
    ),
    "通知分期补尾款",
    IF(
      AND(
        {${initialId}} = "已收定金",
        NOT(
          OR(
            {${paymentTypeId}} = "定金+分2期支付",
            {${paymentTypeId}} = "定金+分3期支付",
            {${paymentTypeId}} = "定金+分4期支付",
            {${paymentTypeId}} = "定金+分期付款"
          )
        )
      ),
      "通知补尾款",
      IF(
        {${initialId}} = "",
        "通知补尾款",
        "通知补尾款"
      )
    )
  )
)`.trim();

        const notificationField = await createField(followTableId, {
          name: '通知类型(后端)',
          type: FieldType.Formula,
          options: {
            expression: buildNotificationExpression(initialPaymentLookup.id, paymentTypeLookup.id),
            timeZone: 'Asia/Taipei',
          },
        });

        const buildSalesExpression = (notificationId: string, remarkId: string) =>
          `
IF(
  AND(
    LEN(TRIM(T({${remarkId}}))) = 0,
    {${notificationId}} != "全款-无需补尾款"
  ),
  "待通知",
  IF(
    {${notificationId}} = "全款-无需补尾款",
    "无需通知",
    IF(
      AND(
        {${notificationId}} != "全款-无需补尾款",
        LEN(TRIM(T({${remarkId}}))) > 0
      ),
      "已通知补尾款",
      IF(
        {${notificationId}} = "",
        "未识别",
        ""
      )
    )
  )
)`.trim();

        const salesField = await createField(followTableId, {
          name: '销售进度1',
          type: FieldType.Formula,
          options: {
            expression: buildSalesExpression(notificationField.id, followRemarkField.id),
            timeZone: 'Asia/Taipei',
          },
        });
        // eslint-disable-next-line no-console
        console.log('sales expression', (salesField.options as { expression: string }).expression);

        // Link follow records to orders and adjust remarks
        await updateRecordByApi(followTableId, followRecords[0].id, orderLink.id, {
          id: orderRecords[0].id,
        });
        await updateRecordByApi(followTableId, followRecords[1].id, orderLink.id, {
          id: orderRecords[1].id,
        });
        await updateRecordByApi(followTableId, followRecords[2].id, orderLink.id, {
          id: orderRecords[2].id,
        });

        await updateRecordByApi(
          followTableId,
          followRecords[2].id,
          followRemarkField.id,
          '已提醒一次'
        );
        const readValue = async (recordId: string) => {
          const record = await getRecord(followTableId, recordId);
          const payload =
            (record as { data?: { fields?: Record<string, unknown> } }).data ?? record;
          const fields = (payload.fields ?? {}) as Record<string, unknown>;
          const getFieldValue = (field: { id: string; name: string }) => {
            return (fields[field.name] ?? fields[field.id]) as string;
          };

          return {
            notification: getFieldValue(notificationField),
            sales: getFieldValue(salesField),
          };
        };

        const expectEventually = async (
          recordId: string,
          expected: { notification: string; sales: string }
        ) => {
          const deadline = Date.now() + 2_000;
          let last = await readValue(recordId);
          while (Date.now() < deadline) {
            if (last.notification === expected.notification && last.sales === expected.sales) {
              return last;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
            last = await readValue(recordId);
          }
          return last;
        };

        expect(
          await expectEventually(followRecords[0].id, {
            notification: '全款-无需补尾款',
            sales: '无需通知',
          })
        ).toEqual({
          notification: '全款-无需补尾款',
          sales: '无需通知',
        });

        expect(
          await expectEventually(followRecords[1].id, {
            notification: '通知分期补尾款',
            sales: '待通知',
          })
        ).toEqual({
          notification: '通知分期补尾款',
          sales: '待通知',
        });

        expect(
          await expectEventually(followRecords[2].id, {
            notification: '通知补尾款',
            sales: '已通知补尾款',
          })
        ).toEqual({
          notification: '通知补尾款',
          sales: '已通知补尾款',
        });

        // Verify SQL conversion uses metadata-derived columns
        const tableSnapshot = await getTable(baseId, followTableId, { includeContent: true });
        const domain = new TableDomain({
          id: tableSnapshot.id,
          name: tableSnapshot.name,
          dbTableName: tableSnapshot.dbTableName!,
          lastModifiedTime: tableSnapshot.lastModifiedTime ?? new Date().toISOString(),
          fields: tableSnapshot.fields.map(createFieldInstanceByVo),
        });
        const alias = 'main';
        const selectionMap = new Map(
          tableSnapshot.fields.map((field) => [field.id, `"${alias}"."${field.dbFieldName!}"`])
        );

        const notificationOptions = notificationField.options as {
          expression: string;
          timeZone?: string;
        };
        const notificationSql = dbProvider.convertFormulaToSelectQuery(
          notificationOptions.expression,
          {
            table: domain,
            selectionMap,
            tableAlias: alias,
            timeZone: notificationOptions.timeZone,
            targetDbFieldType: notificationField.dbFieldType,
            preferRawFieldReferences: true,
          }
        );

        expect(notificationSql).toContain(`"${alias}"."${initialPaymentLookup.dbFieldName!}"`);
        expect(notificationSql).toContain(`"${alias}"."${paymentTypeLookup.dbFieldName!}"`);
        expect(notificationSql).not.toContain('REGEXP_REPLACE');
        expect(notificationSql).not.toContain('pg_typeof');

        const salesOptions = salesField.options as { expression: string; timeZone?: string };
        const salesSql = dbProvider.convertFormulaToSelectQuery(salesOptions.expression, {
          table: domain,
          selectionMap,
          tableAlias: alias,
          timeZone: salesOptions.timeZone,
          targetDbFieldType: salesField.dbFieldType,
          preferRawFieldReferences: true,
        });

        expect(salesSql).toContain(`"${alias}"."${notificationField.dbFieldName!}"`);
        expect(salesSql).toContain(`"${alias}"."${followRemarkField.dbFieldName!}"`);
        expect(salesSql).not.toContain('REGEXP_REPLACE');
        expect(salesSql).not.toContain('pg_typeof');
      } finally {
        if (followTable) {
          await permanentDeleteTable(baseId, followTable.id);
        }
        if (ordersTable) {
          await permanentDeleteTable(baseId, ordersTable.id);
        }
      }
    },
    {
      timeout: 120_000,
    }
  );
});
