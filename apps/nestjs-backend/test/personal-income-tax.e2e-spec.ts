/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */

import type { INestApplication } from '@nestjs/common';
import type { LinkFieldCore } from '@teable/core';
import { FieldType, NumberFormattingType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  convertField,
  createField,
  createTable,
  deleteTable,
  getRecord,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

describe('Personal income tax computed update (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let memberTable: ITableFullVo | undefined;
  let payrollTable: ITableFullVo | undefined;
  const waitForRecalc = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

  const toFieldMap = (table: ITableFullVo) =>
    table.fields.reduce<Record<string, string>>((acc, field) => {
      acc[field.name] = field.id;
      return acc;
    }, {});

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    if (payrollTable) {
      await deleteTable(baseId, payrollTable.id);
    }
    if (memberTable) {
      await deleteTable(baseId, memberTable.id);
    }
    payrollTable = undefined;
    memberTable = undefined;
  });

  it(
    'should update personal income tax via API without tripping lookup-rollup loops',
    { timeout: 60000 },
    async () => {
      memberTable = await createTable(baseId, {
        name: 'Members-e2e',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'AnnualTaxDue',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
          },
          {
            name: 'BaseAmount',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
          },
        ],
        records: [
          {
            fields: {
              Name: 'Alice',
              AnnualTaxDue: 12000,
              BaseAmount: 8000,
            },
          },
        ],
      });

      payrollTable = await createTable(baseId, {
        name: 'Payroll-e2e',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'PayrollMonth', type: FieldType.Date },
          {
            name: 'PayrollBase',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
          },
          {
            name: 'Allowance',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
          },
          {
            name: 'SocialSecurityEmployee',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
          },
          {
            name: 'HousingFundEmployee',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
          },
          {
            name: 'SocialSecurityEmployer',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
          },
          {
            name: 'PersonalIncomeTax',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
          },
        ],
        records: [
          {
            fields: {
              Title: 'Alice-2024-05',
              PayrollMonth: '2024-05-01',
              PayrollBase: 10000,
              Allowance: 500,
              SocialSecurityEmployee: 800,
              HousingFundEmployee: 500,
              SocialSecurityEmployer: 1200,
              PersonalIncomeTax: 1000,
            },
          },
        ],
      });

      const memberFields = toFieldMap(memberTable);
      const payrollFields = toFieldMap(payrollTable);

      const linkPayrollToMember = (await createField(payrollTable.id, {
        name: 'Name',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: memberTable.id,
        },
      })) as LinkFieldCore;
      payrollFields[linkPayrollToMember.name] = linkPayrollToMember.id;

      const symmetricFieldId = linkPayrollToMember.options.symmetricFieldId;
      if (!symmetricFieldId) {
        throw new Error('symmetric field not created');
      }

      const titleField = await convertField(payrollTable.id, payrollFields['Title'], {
        name: 'Title',
        type: FieldType.Formula,
        options: {
          expression: `ARRAYJOIN({${linkPayrollToMember.id}}, ',') & '-' & DATETIME_FORMAT({${payrollFields['PayrollMonth']}}, 'YYYY-MM')`,
        },
      });
      payrollFields[titleField.name] = titleField.id;

      const memberAnnualPaidField = await createField(memberTable.id, {
        name: 'PaidYearToDate',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: payrollTable.id,
          linkFieldId: symmetricFieldId,
          lookupFieldId: payrollFields['PersonalIncomeTax'],
        },
      });
      memberFields[memberAnnualPaidField.name] = memberAnnualPaidField.id;

      const memberMonthlyDueField = await createField(memberTable.id, {
        name: 'MonthlyTaxDue',
        type: FieldType.Formula,
        options: {
          expression: `{${memberFields['AnnualTaxDue']}} - {${memberAnnualPaidField.id}}`,
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });
      memberFields[memberMonthlyDueField.name] = memberMonthlyDueField.id;

      const payrollGrossField = await createField(payrollTable.id, {
        name: 'GrossPay',
        type: FieldType.Formula,
        options: {
          expression: `{${payrollFields['PayrollBase']}} + {${payrollFields['Allowance']}}`,
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });
      payrollFields[payrollGrossField.name] = payrollGrossField.id;

      const payrollNetField = await createField(payrollTable.id, {
        name: 'NetPay',
        type: FieldType.Formula,
        options: {
          expression: `{${payrollGrossField.id}} - {${payrollFields['SocialSecurityEmployee']}} - {${payrollFields['HousingFundEmployee']}} - {${payrollFields['PersonalIncomeTax']}}`,
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });
      payrollFields[payrollNetField.name] = payrollNetField.id;

      const payrollCompanyCostField = await createField(payrollTable.id, {
        name: 'CompanyLaborCost',
        type: FieldType.Formula,
        options: {
          expression: `{${payrollGrossField.id}} + {${payrollFields['SocialSecurityEmployer']}} + {${payrollFields['HousingFundEmployee']}}`,
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });
      payrollFields[payrollCompanyCostField.name] = payrollCompanyCostField.id;

      const payrollBaseLookupField = await createField(payrollTable.id, {
        name: 'MemberBaseLookup',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: memberTable.id,
          linkFieldId: linkPayrollToMember.id,
          lookupFieldId: memberFields['BaseAmount'],
        },
      });
      payrollFields[payrollBaseLookupField.name] = payrollBaseLookupField.id;

      const payrollCumulativeTaxField = await createField(payrollTable.id, {
        name: 'CumulativePaidTax',
        type: FieldType.Rollup,
        isLookup: true,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: memberTable.id,
          linkFieldId: linkPayrollToMember.id,
          lookupFieldId: memberAnnualPaidField.id,
        },
      });
      payrollFields[payrollCumulativeTaxField.name] = payrollCumulativeTaxField.id;

      await updateRecordByApi(payrollTable.id, payrollTable.records[0].id, linkPayrollToMember.id, {
        id: memberTable.records[0].id,
      });

      await waitForRecalc();

      const updatedPersonalTax = 1600;
      await updateRecordByApi(
        payrollTable.id,
        payrollTable.records[0].id,
        payrollFields['PersonalIncomeTax'],
        updatedPersonalTax
      );

      await waitForRecalc();

      const payrollRecord = await getRecord(payrollTable.id, payrollTable.records[0].id);
      const memberRecord = await getRecord(memberTable.id, memberTable.records[0].id);

      expect(payrollRecord.fields[payrollFields['PersonalIncomeTax']]).toEqual(updatedPersonalTax);
      expect(payrollRecord.fields[payrollNetField.id]).toBeCloseTo(
        10500 - 800 - 500 - updatedPersonalTax,
        2
      );
      expect(payrollRecord.fields[payrollCumulativeTaxField.id]).toEqual(updatedPersonalTax);
      expect(memberRecord.fields[memberAnnualPaidField.id]).toEqual(updatedPersonalTax);
      expect(memberRecord.fields[memberMonthlyDueField.id]).toEqual(12000 - updatedPersonalTax);
    }
  );
});
