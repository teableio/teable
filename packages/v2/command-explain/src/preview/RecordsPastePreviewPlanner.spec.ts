import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext, PastePreparation, PastePreparationService } from '@teable/v2-core';

import {
  RecordsPastePreviewPlanner,
  createRecordsPastePreviewRegistration,
  parseRecordsPastePreviewInput,
} from './RecordsPastePreviewPlanner';

const context = {} as IExecutionContext;

const preparation = (overrides: Partial<PastePreparation['facts']> = {}) =>
  ({
    persistedTable: {},
    tableForPaste: {},
    editableColumns: [],
    updateOperations: [],
    createOperations: [],
    typecast: true,
    facts: {
      submittedRows: 3,
      selectedRows: 2,
      acceptedRows: 2,
      updateCandidates: 1,
      createCandidates: 1,
      rejectedSelectedRows: 1,
      submittedCells: 6,
      selectedFieldCount: 2,
      writableFieldCount: 2,
      columnExpansionCount: 1,
      selectOptionCreations: [{ fieldId: {} as never, optionCount: 2 }],
      selectOptionProjection: 'known',
      linkTitleResolutionCandidateCount: 1,
      linkTitleProjection: 'known',
      affectedRowsEstablished: false,
      readAuthorization: 'unknown',
      writeAuthorization: 'unknown',
      ...overrides,
    },
  }) as unknown as PastePreparation;

const commandInput = {
  tableId: `tbl${'a'.repeat(16)}`,
  viewId: `viw${'b'.repeat(16)}`,
  ranges: [
    [0, 0],
    [1, 2],
  ],
  content: [
    ['one', 'Open'],
    ['two', 'Review'],
    ['three', 'Done'],
  ],
};

describe('RecordsPastePreviewPlanner', () => {
  it('parses the ordinary PasteCommand input used by the write route', () => {
    const parsed = parseRecordsPastePreviewInput(commandInput);
    const registration = createRecordsPastePreviewRegistration(
      new RecordsPastePreviewPlanner({} as PastePreparationService)
    );

    expect(parsed.isOk()).toBe(true);
    expect(parsed._unsafeUnwrap().content).toHaveLength(3);
    expect(registration.capability.canonicalWriteRoute).toBe('POST /tables/paste');
    expect(registration.capability.supportLevel).toBe('partial');
  });

  it('rejects a gigantic tiled range before preview preparation', () => {
    const parsed = parseRecordsPastePreviewInput({
      ...commandInput,
      ranges: [
        [0, 0],
        [0, 100_000_000],
      ],
      content: [['x']],
    });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.paste.max_cells_exceeded',
    });
  });

  it('normalizes exact candidates and keeps affected rows and execution policy unknown', async () => {
    const prepare = vi.fn(async () => ok(preparation()));
    const planner = new RecordsPastePreviewPlanner({
      prepare,
    } as unknown as PastePreparationService);
    const command = parseRecordsPastePreviewInput(commandInput)._unsafeUnwrap();

    const result = await planner.preview(context, command, {
      detail: 'full',
      includeComplexity: true,
      maxItems: 100,
    });

    expect(result.isOk()).toBe(true);
    expect(prepare).toHaveBeenCalledWith(context, command, { readAuthorization: 'unknown' });
    const plan = result._unsafeUnwrap();
    expect(plan.blockers).toEqual([
      expect.objectContaining({ code: 'records.paste.selected_rows_not_writable' }),
    ]);
    expect(plan.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'record.update', code: 'records.paste.update_candidates' }),
        expect.objectContaining({ kind: 'record.insert', code: 'records.paste.create_candidates' }),
        expect.objectContaining({ code: 'records.paste.column_expansion' }),
        expect.objectContaining({ code: 'records.paste.select_options' }),
        expect.objectContaining({ code: 'records.paste.link_auto_create_candidates' }),
      ])
    );
    const update = plan.effects.find((effect) => effect.code === 'records.paste.update_candidates');
    expect(update?.measures.updateCandidates).toEqual({ basis: 'exact', value: 1, unit: 'rows' });
    expect(update?.measures.affectedRows).toMatchObject({ basis: 'unknown', unit: 'rows' });
    expect(plan.coverage.unknown).toEqual(
      expect.arrayContaining([
        'record-query-plugin-policy',
        'record-write-plugin-policy',
        'authoritative-affected-rows',
      ])
    );
    expect(plan.complexityProjection).toMatchObject({
      tableId: command.tableId.toString(),
      assumptions: { seedRecordCount: 2 },
      includeCatalogStats: true,
      operation: {
        kind: 'paste',
        tableId: command.tableId.toString(),
        changedFieldIds: [],
        pasteMode: 'mixed',
      },
      coverage: {
        unknown: ['complexity-planner-projection', 'complexity-authoritative-selection'],
      },
    });
    expect(plan.authorization).toBe('checked');
    expect(plan.complexity).toBeNull();
  });

  it('does not invent zero effects when selection evidence is incomplete', async () => {
    const planner = new RecordsPastePreviewPlanner({
      prepare: async () =>
        ok(
          preparation({
            submittedRows: 1,
            selectedRows: 0,
            acceptedRows: 0,
            updateCandidates: 0,
            createCandidates: 0,
            rejectedSelectedRows: 0,
            columnExpansionCount: 0,
            selectOptionCreations: [],
            linkTitleResolutionCandidateCount: 0,
          })
        ),
    } as unknown as PastePreparationService);

    const plan = (
      await planner.preview(context, parseRecordsPastePreviewInput(commandInput)._unsafeUnwrap(), {
        detail: 'summary',
        includeComplexity: false,
        maxItems: 10,
      })
    )._unsafeUnwrap();

    expect(plan.effects).toEqual([]);
    expect(plan.coverage.unknown).toContain('authoritative-affected-rows');
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ code: 'records.paste.write_policy_not_evaluated' })
    );
  });
});
