/* eslint-disable @typescript-eslint/naming-convention */
/**
 * V1-parity coverage for plain rollup expressions (T6520).
 * Ports the portable cases from apps/nestjs-backend/test/rollup.e2e-spec.ts:
 * - "rollup expression coverage" it.each matrix (numbers / text sources)
 * - link-title rollups (concatenate / array_join / array_unique)
 * - array_compact over blank looked-up values
 * - rollup of a formula field feeding multiple rollups
 * - rollup with no link records
 * - rollup targeting conditional computed fields (conditionalRollup / conditionalLookup)
 * - manyOne-side rollups reacting to link edits from either side
 * - average / sum / concatenate rollups reacting to link add / replace / remove
 * - countall over flattened multipleSelect values
 * - rollup value seeding when the field is created after links exist
 * - count over null-bearing sources + numeric rollup validation (hasError)
 *
 * Boolean and/or/xor rollups over checkboxes are covered by
 * computed.e2e.spec.ts ("evaluates and/or/xor over unchecked checkboxes ...").
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 rollup expressions (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;
  const runId = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(10, '0');
    fieldIdCounter += 1;
    return `fld${runId}${suffix}`;
  };

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('expression matrix over linked number/text sources', () => {
    // v1: rollup.e2e-spec.ts "rollup expression coverage"
    let foreignTableId: string;
    let hostTableId: string;
    let hostRecordId: string;
    const labelFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const hostPrimaryFieldId = createFieldId();
    const hostLinkFieldId = createFieldId();

    const rollupCases: Array<{
      expression: string;
      lookupFieldKey: 'amount' | 'label';
      expected: unknown;
      fieldId: string;
    }> = [
      { expression: 'countall({values})', lookupFieldKey: 'amount', expected: 2, fieldId: '' },
      { expression: 'counta({values})', lookupFieldKey: 'label', expected: 2, fieldId: '' },
      { expression: 'count({values})', lookupFieldKey: 'amount', expected: 2, fieldId: '' },
      { expression: 'sum({values})', lookupFieldKey: 'amount', expected: 30, fieldId: '' },
      { expression: 'average({values})', lookupFieldKey: 'amount', expected: 15, fieldId: '' },
      { expression: 'max({values})', lookupFieldKey: 'amount', expected: 20, fieldId: '' },
      { expression: 'min({values})', lookupFieldKey: 'amount', expected: 10, fieldId: '' },
      {
        expression: 'array_join({values})',
        lookupFieldKey: 'label',
        expected: 'Alpha, Beta',
        fieldId: '',
      },
      {
        expression: 'array_unique({values})',
        lookupFieldKey: 'label',
        expected: ['Alpha', 'Beta'],
        fieldId: '',
      },
      {
        expression: 'array_compact({values})',
        lookupFieldKey: 'label',
        expected: ['Alpha', 'Beta'],
        fieldId: '',
      },
      {
        expression: 'concatenate({values})',
        lookupFieldKey: 'label',
        expected: 'Alpha, Beta',
        fieldId: '',
      },
    ];

    beforeAll(async () => {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RollupExpr Foreign',
        fields: [
          { type: 'singleLineText', id: labelFieldId, name: 'Label', isPrimary: true },
          { type: 'number', id: amountFieldId, name: 'Amount' },
        ],
      });
      foreignTableId = foreign.id;

      const alpha = await ctx.createRecord(foreign.id, {
        [labelFieldId]: 'Alpha',
        [amountFieldId]: 10,
      });
      const beta = await ctx.createRecord(foreign.id, {
        [labelFieldId]: 'Beta',
        [amountFieldId]: 20,
      });

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RollupExpr Host',
        fields: [{ type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true }],
      });
      hostTableId = host.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'link',
          id: hostLinkFieldId,
          name: 'Links',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreign.id,
            lookupFieldId: labelFieldId,
            isOneWay: true,
          },
        },
      });

      for (const rollupCase of rollupCases) {
        const rollupFieldId = createFieldId();
        rollupCase.fieldId = rollupFieldId;
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: rollupFieldId,
            name: `rollup ${rollupCase.expression} ${rollupCase.lookupFieldKey}`,
            options: { expression: rollupCase.expression },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: rollupCase.lookupFieldKey === 'amount' ? amountFieldId : labelFieldId,
            },
          },
        });
      }

      const hostRecord = await ctx.createRecord(host.id, {
        [hostPrimaryFieldId]: 'Rollup Holder',
        [hostLinkFieldId]: [{ id: alpha.id }, { id: beta.id }],
      });
      hostRecordId = hostRecord.id;

      await drainOutbox();
    });

    afterAll(async () => {
      if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
      if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
    });

    it.each(rollupCases)(
      'computes rollup using $expression over $lookupFieldKey',
      async ({ expected, fieldId, expression }) => {
        const records = await ctx.listRecords(hostTableId);
        const record = records.find((r) => r.id === hostRecordId);
        expect(record).toBeDefined();
        const value = record?.fields[fieldId];

        if (Array.isArray(expected)) {
          expect(Array.isArray(value), `${expression} should return an array`).toBe(true);
          expect([...(value as unknown[])].sort()).toEqual([...expected].sort());
        } else if (typeof expected === 'string' && expected.includes(', ')) {
          expect((value as string).split(', ').sort()).toEqual(expected.split(', ').sort());
        } else {
          expect(value).toEqual(expected);
        }
      }
    );
  });

  describe('filtered rollup link scope', () => {
    it('keeps OR filter branches inside each oneMany link scope (T7004)', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostRollupFieldId = createFieldId();
      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupFilterScope Foreign',
          fields: [
            {
              type: 'singleLineText',
              id: foreignNameFieldId,
              name: 'Name',
              isPrimary: true,
            },
            { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
            { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
          ],
        });
        foreignTableId = foreign.id;
        const linkedMatch = await ctx.createRecord(foreign.id, {
          [foreignNameFieldId]: 'Linked match',
          [foreignAmountFieldId]: 10,
          [foreignCategoryFieldId]: 'A',
        });
        await ctx.createRecord(foreign.id, {
          [foreignNameFieldId]: 'Unlinked match',
          [foreignAmountFieldId]: 20,
          [foreignCategoryFieldId]: 'B',
        });
        await ctx.createRecord(foreign.id, {
          [foreignNameFieldId]: 'Excluded',
          [foreignAmountFieldId]: 30,
          [foreignCategoryFieldId]: 'C',
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupFilterScope Host',
          fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
        });
        hostTableId = host.id;
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Items',
            options: {
              relationship: 'oneMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignNameFieldId,
            },
          },
        });

        const linkedHost = await ctx.createRecord(host.id, {
          [hostNameFieldId]: 'Linked host',
          [hostLinkFieldId]: [{ id: linkedMatch.id }],
        });
        const existingUnlinkedHost = await ctx.createRecord(host.id, {
          [hostNameFieldId]: 'Existing unlinked host',
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: hostRollupFieldId,
            name: 'Filtered total',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: foreignAmountFieldId,
              filter: {
                conjunction: 'or',
                filterSet: [
                  { fieldId: foreignCategoryFieldId, operator: 'is', value: 'A' },
                  { fieldId: foreignCategoryFieldId, operator: 'is', value: 'B' },
                ],
              },
            },
          },
        });
        await drainOutbox();

        const backfilledRecords = await ctx.listRecords(host.id);
        expect(
          backfilledRecords.find((record) => record.id === linkedHost.id)?.fields[hostRollupFieldId]
        ).toBe(10);
        expect(
          backfilledRecords.find((record) => record.id === existingUnlinkedHost.id)?.fields[
            hostRollupFieldId
          ]
        ).toBe(0);

        const newUnlinkedHost = await ctx.createRecord(host.id, {
          [hostNameFieldId]: 'New unlinked host',
        });
        await drainOutbox();
        const recordsAfterInsert = await ctx.listRecords(host.id);
        expect(
          recordsAfterInsert.find((record) => record.id === newUnlinkedHost.id)?.fields[
            hostRollupFieldId
          ]
        ).toBe(0);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });
  });

  describe('rolling up a link field', () => {
    // v1: rollup.e2e-spec.ts "concatenates link titles ..." / "joins link titles ..."
    it('concatenates and joins link titles when rolling up a link field', async () => {
      const serviceTitleFieldId = createFieldId();
      const employeeNameFieldId = createFieldId();
      const employeeServicesLinkFieldId = createFieldId();
      const deptNameFieldId = createFieldId();
      const deptEmployeesLinkFieldId = createFieldId();
      const concatRollupFieldId = createFieldId();
      const joinRollupFieldId = createFieldId();

      let servicesTableId: string | undefined;
      let employeesTableId: string | undefined;
      let departmentsTableId: string | undefined;

      try {
        const services = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupLink Services',
          fields: [
            { type: 'singleLineText', id: serviceTitleFieldId, name: 'Title', isPrimary: true },
          ],
        });
        servicesTableId = services.id;
        const international = await ctx.createRecord(services.id, {
          [serviceTitleFieldId]: 'International',
        });
        const btob = await ctx.createRecord(services.id, { [serviceTitleFieldId]: 'BtoB' });

        const employees = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupLink Employees',
          fields: [
            { type: 'singleLineText', id: employeeNameFieldId, name: 'Name', isPrimary: true },
          ],
        });
        employeesTableId = employees.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: employees.id,
          field: {
            type: 'link',
            id: employeeServicesLinkFieldId,
            name: 'Services',
            options: {
              relationship: 'manyMany',
              foreignTableId: services.id,
              lookupFieldId: serviceTitleFieldId,
              isOneWay: true,
            },
          },
        });

        const alice = await ctx.createRecord(employees.id, {
          [employeeNameFieldId]: 'Alice',
          [employeeServicesLinkFieldId]: [{ id: international.id }, { id: btob.id }],
        });

        const departments = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupLink Departments',
          fields: [{ type: 'singleLineText', id: deptNameFieldId, name: 'Dept', isPrimary: true }],
        });
        departmentsTableId = departments.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: departments.id,
          field: {
            type: 'link',
            id: deptEmployeesLinkFieldId,
            name: 'Employees',
            options: {
              relationship: 'manyMany',
              foreignTableId: employees.id,
              lookupFieldId: employeeNameFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: departments.id,
          field: {
            type: 'rollup',
            id: concatRollupFieldId,
            name: 'service_titles',
            options: { expression: 'concatenate({values})' },
            config: {
              linkFieldId: deptEmployeesLinkFieldId,
              foreignTableId: employees.id,
              lookupFieldId: employeeServicesLinkFieldId,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: departments.id,
          field: {
            type: 'rollup',
            id: joinRollupFieldId,
            name: 'service_titles_join',
            options: { expression: 'array_join({values})' },
            config: {
              linkFieldId: deptEmployeesLinkFieldId,
              foreignTableId: employees.id,
              lookupFieldId: employeeServicesLinkFieldId,
            },
          },
        });

        const hr = await ctx.createRecord(departments.id, {
          [deptNameFieldId]: 'HR',
          [deptEmployeesLinkFieldId]: [{ id: alice.id }],
        });

        await drainOutbox();

        const records = await ctx.listRecords(departments.id);
        const record = records.find((r) => r.id === hr.id);
        expect((record?.fields[concatRollupFieldId] as string).split(', ').sort()).toEqual(
          ['International', 'BtoB'].sort()
        );
        expect((record?.fields[joinRollupFieldId] as string).split(', ').sort()).toEqual(
          ['International', 'BtoB'].sort()
        );
      } finally {
        if (departmentsTableId) await ctx.deleteTable(departmentsTableId).catch(() => undefined);
        if (employeesTableId) await ctx.deleteTable(employeesTableId).catch(() => undefined);
        if (servicesTableId) await ctx.deleteTable(servicesTableId).catch(() => undefined);
      }
    });

    // v1: rollup.e2e-spec.ts "deduplicates link titles with array_unique when rolling up a link field"
    it('deduplicates link titles with array_unique when rolling up a link field', async () => {
      const serviceTitleFieldId = createFieldId();
      const employeeNameFieldId = createFieldId();
      const employeeServicesLinkFieldId = createFieldId();
      const deptNameFieldId = createFieldId();
      const deptEmployeesLinkFieldId = createFieldId();
      const uniqueRollupFieldId = createFieldId();

      let servicesTableId: string | undefined;
      let employeesTableId: string | undefined;
      let departmentsTableId: string | undefined;

      try {
        const services = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupLinkUnique Services',
          fields: [
            { type: 'singleLineText', id: serviceTitleFieldId, name: 'Title', isPrimary: true },
          ],
        });
        servicesTableId = services.id;
        const international = await ctx.createRecord(services.id, {
          [serviceTitleFieldId]: 'International',
        });
        const btob = await ctx.createRecord(services.id, { [serviceTitleFieldId]: 'BtoB' });

        const employees = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupLinkUnique Employees',
          fields: [
            { type: 'singleLineText', id: employeeNameFieldId, name: 'Name', isPrimary: true },
          ],
        });
        employeesTableId = employees.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: employees.id,
          field: {
            type: 'link',
            id: employeeServicesLinkFieldId,
            name: 'Services',
            options: {
              relationship: 'manyMany',
              foreignTableId: services.id,
              lookupFieldId: serviceTitleFieldId,
              isOneWay: true,
            },
          },
        });

        const alice = await ctx.createRecord(employees.id, {
          [employeeNameFieldId]: 'Alice',
          [employeeServicesLinkFieldId]: [{ id: international.id }],
        });
        const bob = await ctx.createRecord(employees.id, {
          [employeeNameFieldId]: 'Bob',
          [employeeServicesLinkFieldId]: [{ id: btob.id }],
        });

        const departments = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupLinkUnique Departments',
          fields: [{ type: 'singleLineText', id: deptNameFieldId, name: 'Dept', isPrimary: true }],
        });
        departmentsTableId = departments.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: departments.id,
          field: {
            type: 'link',
            id: deptEmployeesLinkFieldId,
            name: 'Employees',
            options: {
              relationship: 'manyMany',
              foreignTableId: employees.id,
              lookupFieldId: employeeNameFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: departments.id,
          field: {
            type: 'rollup',
            id: uniqueRollupFieldId,
            name: 'service_titles_unique',
            options: { expression: 'array_unique({values})' },
            config: {
              linkFieldId: deptEmployeesLinkFieldId,
              foreignTableId: employees.id,
              lookupFieldId: employeeServicesLinkFieldId,
            },
          },
        });

        const hr = await ctx.createRecord(departments.id, {
          [deptNameFieldId]: 'HR',
          [deptEmployeesLinkFieldId]: [{ id: alice.id }, { id: bob.id }],
        });

        await drainOutbox();

        const records = await ctx.listRecords(departments.id);
        const record = records.find((r) => r.id === hr.id);
        const values = record?.fields[uniqueRollupFieldId] as string[];
        expect(values).toHaveLength(2);
        expect(values).toEqual(expect.arrayContaining(['International', 'BtoB']));
      } finally {
        if (departmentsTableId) await ctx.deleteTable(departmentsTableId).catch(() => undefined);
        if (employeesTableId) await ctx.deleteTable(employeesTableId).catch(() => undefined);
        if (servicesTableId) await ctx.deleteTable(servicesTableId).catch(() => undefined);
      }
    });
  });

  describe('rollup corner cases', () => {
    // v1: rollup.e2e-spec.ts "should create rollup fields with array join, unique, and compact expressions" (compact part)
    it('removes blank looked-up values with array_compact', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignTextFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const compactRollupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupCompact Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: foreignTextFieldId, name: 'Text' },
          ],
        });
        foreignTableId = foreign.id;

        const r1 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'R1',
          [foreignTextFieldId]: 'Gamma',
        });
        const r2 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'R2',
          [foreignTextFieldId]: '',
        });
        const r3 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'R3',
          [foreignTextFieldId]: null,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupCompact Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: compactRollupFieldId,
            name: 'compact_texts',
            options: { expression: 'array_compact({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: foreignTextFieldId,
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Holder',
          [hostLinkFieldId]: [{ id: r1.id }, { id: r2.id }, { id: r3.id }],
        });

        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[compactRollupFieldId]).toEqual(['Gamma']);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // v1: rollup.e2e-spec.ts "should update multiple field when rollup to sum a formula field"
    it('updates multiple rollups when summing the same formula field', async () => {
      const sourcePrimaryFieldId = createFieldId();
      const sourceNumberFieldId = createFieldId();
      const sourceFormulaFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const rollup1FieldId = createFieldId();
      const rollup2FieldId = createFieldId();

      let sourceTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const source = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupFormula Source',
          fields: [
            { type: 'singleLineText', id: sourcePrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: sourceNumberFieldId, name: 'Num' },
            {
              type: 'formula',
              id: sourceFormulaFieldId,
              name: 'NumFormula',
              options: { expression: `{${sourceNumberFieldId}}` },
            },
          ],
        });
        sourceTableId = source.id;

        const r1 = await ctx.createRecord(source.id, {
          [sourcePrimaryFieldId]: 'S1',
          [sourceNumberFieldId]: 1,
        });
        const r2 = await ctx.createRecord(source.id, {
          [sourcePrimaryFieldId]: 'S2',
          [sourceNumberFieldId]: 2,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupFormula Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Sources',
            options: {
              relationship: 'manyMany',
              foreignTableId: source.id,
              lookupFieldId: sourcePrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        for (const rollupFieldId of [rollup1FieldId, rollup2FieldId]) {
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: host.id,
            field: {
              type: 'rollup',
              id: rollupFieldId,
              name: `rollup ${rollupFieldId}`,
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId: hostLinkFieldId,
                foreignTableId: source.id,
                lookupFieldId: sourceFormulaFieldId,
              },
            },
          });
        }

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Holder',
          [hostLinkFieldId]: [{ id: r1.id }, { id: r2.id }],
        });

        await drainOutbox();

        let records = await ctx.listRecords(host.id);
        let record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[rollup1FieldId]).toEqual(3);
        expect(record?.fields[rollup2FieldId]).toEqual(3);

        await ctx.updateRecord(source.id, r2.id, { [sourceNumberFieldId]: 3 });
        await drainOutbox();

        records = await ctx.listRecords(host.id);
        record = records.find((r) => r.id === hostRecord.id);
        expect([record?.fields[rollup1FieldId], record?.fields[rollup2FieldId]]).toEqual([4, 4]);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (sourceTableId) await ctx.deleteTable(sourceTableId).catch(() => undefined);
      }
    });

    // v1: rollup.e2e-spec.ts "should calculate rollup event has no link record"
    it('computes sum rollup as 0 when the host has no link record', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const rollupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupNoLink Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: foreignNumberFieldId, name: 'Num' },
          ],
        });
        foreignTableId = foreign.id;

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupNoLink Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: rollupFieldId,
            name: 'sum_no_links',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: foreignNumberFieldId,
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, { [hostPrimaryFieldId]: 'Lonely' });

        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[rollupFieldId]).toEqual(0);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // v1: rollup.e2e-spec.ts "should update many - one rollupField by remove a linkRecord from cell"
    //   + "should update many - one rollupField by replace a linkRecord from cell"
    it('recomputes manyOne-side rollups when links change from either side', async () => {
      const parentPrimaryFieldId = createFieldId();
      const parentAmountFieldId = createFieldId();
      const childPrimaryFieldId = createFieldId();
      const childLinkFieldId = createFieldId();
      const childSumRollupFieldId = createFieldId();
      const parentCountRollupFieldId = createFieldId();

      let parentTableId: string | undefined;
      let childTableId: string | undefined;

      try {
        const parent = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupManyOne Parent',
          fields: [
            { type: 'singleLineText', id: parentPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: parentAmountFieldId, name: 'Amount' },
          ],
        });
        parentTableId = parent.id;

        const p1 = await ctx.createRecord(parent.id, {
          [parentPrimaryFieldId]: 'P1',
          [parentAmountFieldId]: 123,
        });
        const p2 = await ctx.createRecord(parent.id, {
          [parentPrimaryFieldId]: 'P2',
          [parentAmountFieldId]: null,
        });

        const child = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupManyOne Child',
          fields: [
            { type: 'singleLineText', id: childPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        childTableId = child.id;

        // twoWay manyOne link so parents get a symmetric oneMany field
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: child.id,
          field: {
            type: 'link',
            id: childLinkFieldId,
            name: 'Parent',
            options: {
              relationship: 'manyOne',
              foreignTableId: parent.id,
              lookupFieldId: parentPrimaryFieldId,
            },
          },
        });

        const parentMeta = await ctx.getTableById(parent.id);
        const symmetricField = parentMeta.fields.find(
          (field) =>
            field.type === 'link' &&
            (field.options as { symmetricFieldId?: string } | undefined)?.symmetricFieldId ===
              childLinkFieldId
        );
        expect(symmetricField).toBeDefined();
        const symmetricFieldId = symmetricField!.id;

        // rollup on the manyOne (child) side: sum of the single linked parent amount
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: child.id,
          field: {
            type: 'rollup',
            id: childSumRollupFieldId,
            name: 'Parent Amount Sum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: childLinkFieldId,
              foreignTableId: parent.id,
              lookupFieldId: parentAmountFieldId,
            },
          },
        });

        // rollup on the oneMany (parent) side: countall of linked children
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: parent.id,
          field: {
            type: 'rollup',
            id: parentCountRollupFieldId,
            name: 'Child Count',
            options: { expression: 'countall({values})' },
            config: {
              linkFieldId: symmetricFieldId,
              foreignTableId: child.id,
              lookupFieldId: childPrimaryFieldId,
            },
          },
        });

        const c1 = await ctx.createRecord(child.id, { [childPrimaryFieldId]: 'C1' });
        const c2 = await ctx.createRecord(child.id, { [childPrimaryFieldId]: 'C2' });
        await drainOutbox();

        const readChild = async (id: string) => {
          const records = await ctx.listRecords(child.id);
          return records.find((r) => r.id === id);
        };
        const readParent = async (id: string) => {
          const records = await ctx.listRecords(parent.id);
          return records.find((r) => r.id === id);
        };

        // link both children from the parent (oneMany) side
        await ctx.updateRecord(parent.id, p1.id, {
          [symmetricFieldId]: [{ id: c1.id }, { id: c2.id }],
        });
        await drainOutbox();

        expect((await readChild(c1.id))?.fields[childSumRollupFieldId]).toEqual(123);
        expect((await readChild(c2.id))?.fields[childSumRollupFieldId]).toEqual(123);
        expect((await readParent(p1.id))?.fields[parentCountRollupFieldId]).toEqual(2);

        // remove one child from the parent side
        await ctx.updateRecord(parent.id, p1.id, { [symmetricFieldId]: [{ id: c1.id }] });
        await drainOutbox();

        expect((await readChild(c1.id))?.fields[childSumRollupFieldId]).toEqual(123);
        expect((await readChild(c2.id))?.fields[childSumRollupFieldId]).toEqual(0);
        expect((await readParent(p1.id))?.fields[parentCountRollupFieldId]).toEqual(1);

        // remove all links from the parent side
        await ctx.updateRecord(parent.id, p1.id, { [symmetricFieldId]: null });
        await drainOutbox();

        expect((await readChild(c1.id))?.fields[childSumRollupFieldId]).toEqual(0);
        expect((await readParent(p1.id))?.fields[parentCountRollupFieldId]).toEqual(0);

        // re-add from the child (manyOne) side
        await ctx.updateRecord(child.id, c1.id, { [childLinkFieldId]: { id: p1.id } });
        await drainOutbox();

        expect((await readChild(c1.id))?.fields[childSumRollupFieldId]).toEqual(123);
        expect((await readParent(p1.id))?.fields[parentCountRollupFieldId]).toEqual(1);

        // replace the child's parent: counts move between parents (v1 "replace" case)
        await ctx.updateRecord(child.id, c1.id, { [childLinkFieldId]: { id: p2.id } });
        await drainOutbox();

        expect((await readChild(c1.id))?.fields[childSumRollupFieldId]).toEqual(0);
        expect((await readParent(p1.id))?.fields[parentCountRollupFieldId]).toEqual(0);
        expect((await readParent(p2.id))?.fields[parentCountRollupFieldId]).toEqual(1);
      } finally {
        if (childTableId) await ctx.deleteTable(childTableId).catch(() => undefined);
        if (parentTableId) await ctx.deleteTable(parentTableId).catch(() => undefined);
      }
    });

    // v1: rollup.e2e-spec.ts "should calculate average in one - many rollup field"
    //   + "should update one - many rollupField by add a linkRecord from cell" (concatenate)
    //   + "should update one - many rollupField by replace a linkRecord from cell" (sum)
    it('recomputes average, sum, and concatenate rollups when the link set changes', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const averageRollupFieldId = createFieldId();
      const sumRollupFieldId = createFieldId();
      const concatRollupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupLinkSet Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: foreignNumberFieldId, name: 'Num' },
          ],
        });
        foreignTableId = foreign.id;

        const f1 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'F1',
          [foreignNumberFieldId]: 20,
        });
        const f2 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'F2',
          [foreignNumberFieldId]: 40,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupLinkSet Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        const rollupSpecs = [
          { id: averageRollupFieldId, expression: 'average({values})', name: 'Avg' },
          { id: sumRollupFieldId, expression: 'sum({values})', name: 'Sum' },
          { id: concatRollupFieldId, expression: 'concatenate({values})', name: 'Concat' },
        ];
        for (const spec of rollupSpecs) {
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: host.id,
            field: {
              type: 'rollup',
              id: spec.id,
              name: spec.name,
              options: { expression: spec.expression },
              config: {
                linkFieldId: hostLinkFieldId,
                foreignTableId: foreign.id,
                lookupFieldId: foreignNumberFieldId,
              },
            },
          });
        }

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Holder',
          [hostLinkFieldId]: [{ id: f1.id }],
        });
        await drainOutbox();

        const readHost = async () => {
          const records = await ctx.listRecords(host.id);
          return records.find((r) => r.id === hostRecord.id);
        };

        let record = await readHost();
        expect(record?.fields[averageRollupFieldId]).toEqual(20);
        expect(record?.fields[sumRollupFieldId]).toEqual(20);
        expect(record?.fields[concatRollupFieldId]).toEqual('20');

        // add a link
        await ctx.updateRecord(host.id, hostRecord.id, {
          [hostLinkFieldId]: [{ id: f1.id }, { id: f2.id }],
        });
        await drainOutbox();

        record = await readHost();
        expect(record?.fields[averageRollupFieldId]).toEqual(30);
        expect(record?.fields[sumRollupFieldId]).toEqual(60);
        expect((record?.fields[concatRollupFieldId] as string).split(', ').sort()).toEqual([
          '20',
          '40',
        ]);

        // replace the link set with a single other record
        await ctx.updateRecord(host.id, hostRecord.id, {
          [hostLinkFieldId]: [{ id: f2.id }],
        });
        await drainOutbox();

        record = await readHost();
        expect(record?.fields[averageRollupFieldId]).toEqual(40);
        expect(record?.fields[sumRollupFieldId]).toEqual(40);
        expect(record?.fields[concatRollupFieldId]).toEqual('40');
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // v1: rollup.e2e-spec.ts "should roll up a flat array multiple select field -> one - many rollup field"
    it('counts flattened multipleSelect values with countall', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignTagsFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const countAllRollupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupMultiSelect Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'multipleSelect',
              id: foreignTagsFieldId,
              name: 'Tags',
              options: {
                choices: [
                  { id: 'choRap', name: 'rap', color: 'blue' },
                  { id: 'choRock', name: 'rock', color: 'green' },
                  { id: 'choHiphop', name: 'hiphop', color: 'red' },
                ],
              },
            },
          ],
        });
        foreignTableId = foreign.id;

        const f1 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'F1',
          [foreignTagsFieldId]: ['rap', 'rock'],
        });
        const f2 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'F2',
          [foreignTagsFieldId]: ['rap', 'hiphop'],
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupMultiSelect Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: countAllRollupFieldId,
            name: 'Tag Count',
            options: { expression: 'countall({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: foreignTagsFieldId,
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Holder',
          [hostLinkFieldId]: [{ id: f1.id }, { id: f2.id }],
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const record = records.find((r) => r.id === hostRecord.id);
        // flat array semantics: 2 records x 2 tags = 4 values
        expect(record?.fields[countAllRollupFieldId]).toEqual(4);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // v1: rollup.e2e-spec.ts "should calculate when add a rollup field"
    it('seeds rollup values when the rollup field is created after links exist', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const rollupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupSeed Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        foreignTableId = foreign.id;

        const f1 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'F1' });
        const f2 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'F2' });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupSeed Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        // establish links before the rollup field exists
        const linked = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Linked',
          [hostLinkFieldId]: [{ id: f1.id }, { id: f2.id }],
        });
        const unlinked = await ctx.createRecord(host.id, { [hostPrimaryFieldId]: 'Unlinked' });
        await drainOutbox();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: rollupFieldId,
            name: 'Link Count',
            options: { expression: 'countall({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
            },
          },
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        expect(records.find((r) => r.id === linked.id)?.fields[rollupFieldId]).toEqual(2);
        expect(records.find((r) => r.id === unlinked.id)?.fields[rollupFieldId]).toEqual(0);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // v1: rollup.e2e-spec.ts "should rollup a number field in one - many relationship"
    //   + "Rollup aggregation validation" > "keeps numeric aggregation valid for numeric sources"
    it('keeps numeric rollups valid and skips null values with count', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const countRollupFieldId = createFieldId();
      const sumRollupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupNullCount Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: foreignNumberFieldId, name: 'Num' },
          ],
        });
        foreignTableId = foreign.id;

        const f1 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'F1',
          [foreignNumberFieldId]: null,
        });
        const f2 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'F2',
          [foreignNumberFieldId]: 456,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupNullCount Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: countRollupFieldId,
            name: 'Num Count',
            options: { expression: 'count({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: foreignNumberFieldId,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: sumRollupFieldId,
            name: 'Num Sum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: foreignNumberFieldId,
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Holder',
          [hostLinkFieldId]: [{ id: f1.id }, { id: f2.id }],
        });
        await drainOutbox();

        // numeric aggregation over a numeric source carries no field error
        const hostMeta = await ctx.getTableById(host.id);
        expect(hostMeta.fields.find((f) => f.id === countRollupFieldId)?.hasError).toBeFalsy();
        expect(hostMeta.fields.find((f) => f.id === sumRollupFieldId)?.hasError).toBeFalsy();

        const records = await ctx.listRecords(host.id);
        const record = records.find((r) => r.id === hostRecord.id);
        // count() only counts non-null numeric values
        expect(record?.fields[countRollupFieldId]).toEqual(1);
        expect(record?.fields[sumRollupFieldId]).toEqual(456);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });
  });

  describe('rollup targeting conditional computed fields', () => {
    // v1: rollup.e2e-spec.ts "rollup targeting conditional computed fields"
    it('rolls up conditionalRollup and conditionalLookup values across linked tables', async () => {
      const leafItemFieldId = createFieldId();
      const leafCategoryFieldId = createFieldId();
      const leafScoreFieldId = createFieldId();
      const leafStatusFieldId = createFieldId();
      const middleSummaryFieldId = createFieldId();
      const middleTargetCategoryFieldId = createFieldId();
      const middleCondRollupFieldId = createFieldId();
      const middleCondLookupFieldId = createFieldId();
      const rootRegionFieldId = createFieldId();
      const rootLinkFieldId = createFieldId();
      const rootScoreRollupFieldId = createFieldId();
      const rootItemCountRollupFieldId = createFieldId();
      const rootItemConcatRollupFieldId = createFieldId();

      let leafTableId: string | undefined;
      let middleTableId: string | undefined;
      let rootTableId: string | undefined;

      try {
        const leaf = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupConditional Leaf',
          fields: [
            { type: 'singleLineText', id: leafItemFieldId, name: 'Item', isPrimary: true },
            { type: 'singleLineText', id: leafCategoryFieldId, name: 'Category' },
            { type: 'number', id: leafScoreFieldId, name: 'Score' },
            { type: 'singleLineText', id: leafStatusFieldId, name: 'Status' },
          ],
        });
        leafTableId = leaf.id;

        await ctx.createRecord(leaf.id, {
          [leafItemFieldId]: 'Alpha',
          [leafCategoryFieldId]: 'Hardware',
          [leafScoreFieldId]: 60,
          [leafStatusFieldId]: 'Active',
        });
        await ctx.createRecord(leaf.id, {
          [leafItemFieldId]: 'Beta',
          [leafCategoryFieldId]: 'Hardware',
          [leafScoreFieldId]: 40,
          [leafStatusFieldId]: 'Inactive',
        });
        await ctx.createRecord(leaf.id, {
          [leafItemFieldId]: 'Gamma',
          [leafCategoryFieldId]: 'Software',
          [leafScoreFieldId]: 80,
          [leafStatusFieldId]: 'Active',
        });

        const categoryMatchFilter = {
          conjunction: 'and' as const,
          filterSet: [
            {
              fieldId: leafCategoryFieldId,
              operator: 'is',
              value: middleTargetCategoryFieldId,
              isSymbol: true,
            },
            {
              fieldId: leafStatusFieldId,
              operator: 'is',
              value: 'Active',
            },
          ],
        };

        const middle = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupConditional Middle',
          fields: [
            { type: 'singleLineText', id: middleSummaryFieldId, name: 'Summary', isPrimary: true },
            { type: 'singleLineText', id: middleTargetCategoryFieldId, name: 'Target Category' },
          ],
        });
        middleTableId = middle.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: middle.id,
          field: {
            type: 'conditionalRollup',
            id: middleCondRollupFieldId,
            name: 'Active Category Score',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: leaf.id,
              lookupFieldId: leafScoreFieldId,
              condition: { filter: categoryMatchFilter },
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: middle.id,
          field: {
            type: 'conditionalLookup',
            id: middleCondLookupFieldId,
            name: 'Active Item Names',
            options: {
              foreignTableId: leaf.id,
              lookupFieldId: leafItemFieldId,
              condition: { filter: categoryMatchFilter },
            },
          },
        });

        const hardware = await ctx.createRecord(middle.id, {
          [middleSummaryFieldId]: 'Hardware Overview',
          [middleTargetCategoryFieldId]: 'Hardware',
        });
        const software = await ctx.createRecord(middle.id, {
          [middleSummaryFieldId]: 'Software Overview',
          [middleTargetCategoryFieldId]: 'Software',
        });

        const root = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupConditional Root',
          fields: [
            { type: 'singleLineText', id: rootRegionFieldId, name: 'Region', isPrimary: true },
          ],
        });
        rootTableId = root.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: root.id,
          field: {
            type: 'link',
            id: rootLinkFieldId,
            name: 'Middle Connection',
            options: {
              relationship: 'manyMany',
              foreignTableId: middle.id,
              lookupFieldId: middleSummaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: root.id,
          field: {
            type: 'rollup',
            id: rootScoreRollupFieldId,
            name: 'Score Sum',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: rootLinkFieldId,
              foreignTableId: middle.id,
              lookupFieldId: middleCondRollupFieldId,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: root.id,
          field: {
            type: 'rollup',
            id: rootItemCountRollupFieldId,
            name: 'Active Item Count',
            options: { expression: 'countall({values})' },
            config: {
              linkFieldId: rootLinkFieldId,
              foreignTableId: middle.id,
              lookupFieldId: middleCondLookupFieldId,
            },
          },
        });

        // v1: "should concatenate conditional lookup values when rolled up"
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: root.id,
          field: {
            type: 'rollup',
            id: rootItemConcatRollupFieldId,
            name: 'Active Item Concat',
            options: { expression: 'concatenate({values})' },
            config: {
              linkFieldId: rootLinkFieldId,
              foreignTableId: middle.id,
              lookupFieldId: middleCondLookupFieldId,
            },
          },
        });

        const north = await ctx.createRecord(root.id, {
          [rootRegionFieldId]: 'North',
          [rootLinkFieldId]: [{ id: hardware.id }],
        });
        const global = await ctx.createRecord(root.id, {
          [rootRegionFieldId]: 'Global',
          [rootLinkFieldId]: [{ id: hardware.id }, { id: software.id }],
        });
        const unlinked = await ctx.createRecord(root.id, { [rootRegionFieldId]: 'Unlinked' });

        await drainOutbox();

        const middleRecords = await ctx.listRecords(middle.id);
        const hardwareRecord = middleRecords.find((r) => r.id === hardware.id);
        const softwareRecord = middleRecords.find((r) => r.id === software.id);
        expect(hardwareRecord?.fields[middleCondRollupFieldId]).toEqual(60);
        expect(softwareRecord?.fields[middleCondRollupFieldId]).toEqual(80);
        expect(hardwareRecord?.fields[middleCondLookupFieldId]).toEqual(['Alpha']);
        expect(softwareRecord?.fields[middleCondLookupFieldId]).toEqual(['Gamma']);

        const rootRecords = await ctx.listRecords(root.id);
        const northRecord = rootRecords.find((r) => r.id === north.id);
        const globalRecord = rootRecords.find((r) => r.id === global.id);
        const unlinkedRecord = rootRecords.find((r) => r.id === unlinked.id);

        expect(northRecord?.fields[rootScoreRollupFieldId]).toEqual(60);
        expect(globalRecord?.fields[rootScoreRollupFieldId]).toEqual(140);
        expect(unlinkedRecord?.fields[rootScoreRollupFieldId]).toEqual(0);

        expect(northRecord?.fields[rootItemCountRollupFieldId]).toEqual(1);
        expect(globalRecord?.fields[rootItemCountRollupFieldId]).toEqual(2);
        expect(unlinkedRecord?.fields[rootItemCountRollupFieldId]).toEqual(0);

        // concatenate over conditionalLookup arrays keeps each middle row's
        // JSON-encoded array segment (v1 behaved the same; its test decoded
        // the segments before asserting)
        const decodeConcatRollup = (value: unknown): unknown[] => {
          if (value == null || value === '') return [];
          if (Array.isArray(value)) return value;
          if (typeof value !== 'string') return [value];
          const tryParse = (input: string) => {
            try {
              return JSON.parse(input) as unknown;
            } catch {
              return undefined;
            }
          };
          const direct = tryParse(value);
          if (direct !== undefined) return Array.isArray(direct) ? direct.flat() : [direct];
          return value
            .split('],')
            .map((part) => {
              const normalized = part.trim();
              const withBracket = normalized.endsWith(']') ? normalized : `${normalized}]`;
              const parsed = tryParse(withBracket);
              return parsed ?? [normalized.replace(/^\[|"|'|\]$/g, '')];
            })
            .flat();
        };

        expect(decodeConcatRollup(northRecord?.fields[rootItemConcatRollupFieldId])).toEqual([
          'Alpha',
        ]);
        expect(
          decodeConcatRollup(globalRecord?.fields[rootItemConcatRollupFieldId]).sort()
        ).toEqual(['Alpha', 'Gamma']);
        expect(decodeConcatRollup(unlinkedRecord?.fields[rootItemConcatRollupFieldId])).toEqual([]);
      } finally {
        if (rootTableId) await ctx.deleteTable(rootTableId).catch(() => undefined);
        if (middleTableId) await ctx.deleteTable(middleTableId).catch(() => undefined);
        if (leafTableId) await ctx.deleteTable(leafTableId).catch(() => undefined);
      }
    });
  });
});
