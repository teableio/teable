/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T6980: sanitized, structure-equivalent to production V2SchemaOperationFailure
 * BACKEND-AI-1GM (Sentry issue 7692302858).
 *
 * Retained structural facts only:
 * - SWITCH formula over a singleSelect with four result branches reading
 *   same-table number columns and rollup max aggregates (all double precision)
 * - SWITCH default branch reading a multi-value (oneMany two-way) link column
 *   stored as jsonb
 * - computed backfill during field create/update (table.update schema operation)
 *
 * Pre-fix, the backfill CASE mixed double precision THENs with the raw jsonb
 * ELSE and Postgres rejected it ("CASE types double precision and jsonb cannot
 * be matched"), killing the schema operation. Customer names, ids, and values
 * are not copied.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 SWITCH formula mixed-storage branches (T6980)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = `swcase${fieldIdCounter.toString(36)}`.padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const drainOutbox = async (maxRounds = 10) => {
    for (let i = 0; i < maxRounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it(
    'backfills a SWITCH whose default branch is a multi-value link jsonb column',
    { timeout: 180_000 },
    async () => {
      const priceNameFieldId = createFieldId();
      const priceAFieldId = createFieldId();
      const priceBFieldId = createFieldId();
      const priceCFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const costBasisFieldId = createFieldId();
      const manualCostFieldId = createFieldId();
      const currentCostFieldId = createFieldId();
      const serviceLinkFieldId = createFieldId();
      const crosswalkLinkFieldId = createFieldId();
      const rollupAFieldId = createFieldId();
      const rollupBFieldId = createFieldId();
      const rollupCFieldId = createFieldId();

      let priceTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const priceTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T6980 Price Book ${Date.now()}`,
          fields: [
            { type: 'singleLineText', id: priceNameFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: priceAFieldId, name: 'Price A' },
            { type: 'number', id: priceBFieldId, name: 'Price B' },
            { type: 'number', id: priceCFieldId, name: 'Price C' },
          ],
          views: [{ type: 'grid' }],
        });
        priceTableId = priceTable.id;
        const serviceA = await ctx.createRecord(priceTable.id, {
          [priceNameFieldId]: 'Service A',
          [priceAFieldId]: 11,
          [priceBFieldId]: 22,
          [priceCFieldId]: 33,
        });
        const serviceB = await ctx.createRecord(priceTable.id, {
          [priceNameFieldId]: 'Service B',
          [priceAFieldId]: 44,
          [priceBFieldId]: 55,
          [priceCFieldId]: 66,
        });

        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T6980 Services ${Date.now()}`,
          fields: [
            { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: costBasisFieldId,
              name: 'Cost Basis',
              options: {
                choices: [
                  { name: 'Manual Override', color: 'blue' },
                  { name: 'Provider', color: 'green' },
                  { name: 'Clinician', color: 'red' },
                  { name: 'Patient', color: 'yellow' },
                  { name: 'Unmapped Basis', color: 'gray' },
                ],
              },
            },
            { type: 'number', id: manualCostFieldId, name: 'Manual Cost' },
            { type: 'number', id: currentCostFieldId, name: 'Current Cost' },
            {
              type: 'link',
              id: serviceLinkFieldId,
              name: 'Service Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: priceTable.id,
                lookupFieldId: priceNameFieldId,
              },
            },
            {
              type: 'link',
              id: crosswalkLinkFieldId,
              name: 'Crosswalk',
              options: {
                relationship: 'oneMany',
                foreignTableId: priceTable.id,
                lookupFieldId: priceNameFieldId,
              },
            },
            {
              type: 'rollup',
              id: rollupAFieldId,
              name: 'Rollup A',
              options: { expression: 'max({values})' },
              config: {
                linkFieldId: serviceLinkFieldId,
                foreignTableId: priceTable.id,
                lookupFieldId: priceAFieldId,
              },
            },
            {
              type: 'rollup',
              id: rollupBFieldId,
              name: 'Rollup B',
              options: { expression: 'max({values})' },
              config: {
                linkFieldId: serviceLinkFieldId,
                foreignTableId: priceTable.id,
                lookupFieldId: priceBFieldId,
              },
            },
            {
              type: 'rollup',
              id: rollupCFieldId,
              name: 'Rollup C',
              options: { expression: 'max({values})' },
              config: {
                linkFieldId: serviceLinkFieldId,
                foreignTableId: priceTable.id,
                lookupFieldId: priceCFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        hostTableId = hostTable.id;

        const hostA = await ctx.createRecord(hostTable.id, {
          [hostNameFieldId]: 'Host A',
          [costBasisFieldId]: 'Provider',
          [serviceLinkFieldId]: { id: serviceA.id },
          [crosswalkLinkFieldId]: [{ id: serviceA.id }],
        });
        const hostB = await ctx.createRecord(hostTable.id, {
          [hostNameFieldId]: 'Host B',
          [costBasisFieldId]: 'Unmapped Basis',
          [currentCostFieldId]: 7,
          [crosswalkLinkFieldId]: [{ id: serviceB.id }],
        });
        await drainOutbox();

        // Numeric-only default: the shape of the current production formula.
        const numericFormula = await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Effective Cost Numeric',
            options: {
              expression: `SWITCH({${costBasisFieldId}}, "Manual Override", {${manualCostFieldId}}, "Provider", {${rollupAFieldId}}, "Clinician", {${rollupBFieldId}}, "Patient", {${rollupCFieldId}}, {${currentCostFieldId}})`,
            },
          },
        });
        await drainOutbox();
        const numericFormulaId =
          numericFormula.fields.find((field) => field.name === 'Effective Cost Numeric')?.id ?? '';
        expect(numericFormulaId).toMatch(/^fld/);

        // Multi-value link jsonb default: the shape that killed the production op.
        const mixedFormula = await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'formula',
            name: 'Effective Cost Mixed',
            options: {
              expression: `SWITCH({${costBasisFieldId}}, "Manual Override", {${manualCostFieldId}}, "Provider", {${rollupAFieldId}}, "Clinician", {${rollupBFieldId}}, "Patient", {${rollupCFieldId}}, {${crosswalkLinkFieldId}})`,
            },
          },
        });
        await drainOutbox();
        const mixedFormulaId =
          mixedFormula.fields.find((field) => field.name === 'Effective Cost Mixed')?.id ?? '';
        expect(mixedFormulaId).toMatch(/^fld/);

        // Re-backfill through table.update, the operation that died in production.
        await ctx.updateField({
          tableId: hostTable.id,
          fieldId: mixedFormulaId,
          field: {
            type: 'formula',
            name: 'Effective Cost Mixed',
            options: {
              expression: `SWITCH({${costBasisFieldId}}, "Manual Override", {${manualCostFieldId}}, "Provider", {${rollupAFieldId}}, "Clinician", {${rollupBFieldId}}, "Patient", {${rollupCFieldId}}, {${crosswalkLinkFieldId}})`,
            },
          },
        });
        await drainOutbox();

        const tableAfter = await ctx.getTableById(hostTable.id);
        const mixedMeta = tableAfter.fields.find((field) => field.id === mixedFormulaId);
        expect(mixedMeta?.hasError).toBeFalsy();

        const records = await ctx.listRecords(hostTable.id);
        const recordA = records.find((record) => record.id === hostA.id);
        const recordB = records.find((record) => record.id === hostB.id);
        expect(recordA).toBeDefined();
        expect(recordB).toBeDefined();

        expect(Number(recordA?.fields[numericFormulaId])).toBe(11);
        expect(Number(recordB?.fields[numericFormulaId])).toBe(7);

        expect(String(recordA?.fields[mixedFormulaId])).toContain('11');
        expect(String(recordB?.fields[mixedFormulaId])).toContain('Service B');
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (priceTableId) await ctx.deleteTable(priceTableId).catch(() => undefined);
      }
    }
  );

  it(
    'backfills a string-typed SWITCH and its downstream numeric comparison (T6998)',
    { timeout: 180_000 },
    async () => {
      // T6998: sanitized, structure-equivalent to the production v2 computed
      // dead letters (app.teable.cn, 2026-08-26, sqlState 22P02).
      //
      // Retained structural facts only:
      // - SWITCH over a singleSelect with three string-literal result branches
      //   ('0') and a number-typed default branch
      //   INT(DATETIME_DIFF(Now(), {date}, "days")); production's default read
      //   a rollup date column, but only the number-typed default matters here
      // - the SWITCH formula metadata stays string-typed and persists as text
      // - a second formula compares the SWITCH field with a number literal
      //
      // Pre-fix, the SWITCH CASE was typed double precision by Postgres
      // (unknown '0' literals resolved against the float8 default) while the
      // downstream comparison trusted the string metadata and emitted
      // COALESCE(<switch ref>, ''), failing at parse time with
      // invalid input syntax for type double precision: "".
      const nameFieldId = createFieldId();
      const statusFieldId = createFieldId();
      const lastUpdateFieldId = createFieldId();
      const daysSinceUpdateFieldId = createFieldId();
      const followupFlagFieldId = createFieldId();

      let tableId: string | undefined;
      try {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T6998 Followup ${Date.now()}`,
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: statusFieldId,
              name: 'Status',
              options: {
                choices: [
                  { name: 'Alpha', color: 'blue' },
                  { name: 'Beta', color: 'green' },
                  { name: 'Gamma', color: 'red' },
                  { name: 'Active', color: 'yellow' },
                ],
              },
            },
            { type: 'date', id: lastUpdateFieldId, name: 'Last Update' },
          ],
          views: [{ type: 'grid' }],
        });
        tableId = table.id;

        await ctx.createRecord(table.id, { [nameFieldId]: 'r1', [statusFieldId]: 'Alpha' });
        const rec2 = await ctx.createRecord(table.id, {
          [nameFieldId]: 'r2',
          [statusFieldId]: 'Active',
          [lastUpdateFieldId]: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        });
        await ctx.createRecord(table.id, {
          [nameFieldId]: 'r3',
          [statusFieldId]: 'Active',
          [lastUpdateFieldId]: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            id: daysSinceUpdateFieldId,
            name: 'Days Since Update',
            options: {
              expression: `SWITCH({${statusFieldId}}, "Alpha", "0", "Beta", "0", "Gamma", "0", INT(DATETIME_DIFF(Now(), {${lastUpdateFieldId}}, "days")))`,
            },
          },
        });
        await drainOutbox();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            id: followupFlagFieldId,
            name: 'Followup Flag',
            options: {
              expression: `IF({${daysSinceUpdateFieldId}} > 7, "STALE", "OK")`,
            },
          },
        });
        await drainOutbox();

        // Production trigger: a source-field update dirties the SWITCH field and
        // its downstream comparison in one computed plan (level_0 + level_1 in
        // a single UPDATE ... FROM (SELECT ...) statement). Pre-fix this
        // dead-lettered with invalid input syntax for type double precision: "".
        await ctx.updateRecord(table.id, rec2.id, {
          [lastUpdateFieldId]: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
        });
        await drainOutbox();

        const tableAfter = await ctx.getTableById(table.id);
        const daysMeta = tableAfter.fields.find((field) => field.id === daysSinceUpdateFieldId);
        const flagMeta = tableAfter.fields.find((field) => field.id === followupFlagFieldId);
        expect(daysMeta?.hasError).toBeFalsy();
        expect(flagMeta?.hasError).toBeFalsy();

        const records = await ctx.listRecords(table.id);
        const byName = (name: string) =>
          records.find((record) => record.fields[nameFieldId] === name);
        expect(String(byName('r1')?.fields[daysSinceUpdateFieldId])).toBe('0');
        expect(String(byName('r1')?.fields[followupFlagFieldId])).toBe('OK');
        expect(String(byName('r2')?.fields[daysSinceUpdateFieldId])).toBe('12');
        expect(String(byName('r2')?.fields[followupFlagFieldId])).toBe('STALE');
        expect(String(byName('r3')?.fields[daysSinceUpdateFieldId])).toBe('3');
        expect(String(byName('r3')?.fields[followupFlagFieldId])).toBe('OK');
      } finally {
        if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  );
});
