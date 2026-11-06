import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { instrumentBulkUpdateSource, recordUpdateRetentionPlugin } from './observeBulkUpdate';

// Executable stand-in for the checkpoint scopes, not a copy of the service.
// The transform must preserve early exits, awaited persistence, object identity,
// and access to only the roots whose lexical scope still exists at each stage.
const fixture = `
class RecordBulkUpdateService {
  async update(input) {
    const executionResult = await this.executeExplicitRecordUpdates({}, input, input.records);
    const updateUndoCommands = input.buildUndo === false || !executionResult.eventData.length
      ? [] : [{ type: 'UpdateRecords', payload: { records: executionResult.eventData } }];
    const updateRedoCommands = input.buildUndo === false || !executionResult.eventData.length
      ? [] : [{ type: 'UpdateRecords', payload: { records: executionResult.eventData } }];
    if (updateUndoCommands.length) {
      await input.appendUndo(updateUndoCommands, updateRedoCommands);
    }
    await executionResult.pluginExecution.afterCommit();
    return executionResult;
  }

  async executeExplicitRecordUpdates(context, input, records) {
    const resolvedUpdates = records;
    const currentRecordsResult = await traceRecordBulkUpdatePhase(
      context, 'loadExplicitCurrentRecords', {}, async () => ({ records })
    );
    const authorizedUpdates = resolvedUpdates;
    const pluginExecution = { afterCommit: input.afterCommit };
    if (!authorizedUpdates.length) return { eventData: [], records: [], pluginExecution };
    const fieldUpdateTargets = authorizedUpdates;
    const preparedWrite = {};
    const pendingEventData = [];
    const eventData = [];
    const responseFieldsByRecord = new Map();
    if (fieldUpdateTargets.length > 0) {
      const persistedBatches = [];
      const fillLinkTitleSpecs = [];
      let resolvedIndex = 0;
      let maxBatchSize = 0;
      let batchIndex = 0;
      while (true) {
        if (batchIndex >= records.length) break;
        persistedBatches.push(records[batchIndex]);
        pendingEventData.push(records[batchIndex]);
        resolvedIndex += 1;
        maxBatchSize = 1;
        batchIndex += 1;
      }
      const authorizedSummary = summarizeExplicitUpdates(authorizedUpdates);
      const persistResult = await traceRecordBulkUpdatePhase(
        context, 'updateManyStream', {}, async () => input.persist(persistedBatches)
      );
      await traceRecordBulkUpdatePhase(
        context, 'buildPersistedEventData', {}, async () => {
          eventData.push(...persistResult.events);
        }
      );
    }
    const materializedRecords = [];
    await traceRecordBulkUpdatePhase(
      context, 'materializeResultRecords', {}, async () => {
        materializedRecords.push(...records);
      }
    );
    return { eventData, records: materializedRecords, pluginExecution };
  }
}
`;

type Row = { id: string; fields?: Record<string, unknown> };
type Roots = Record<string, unknown>;
type Observer = (stage: string, roots: Roots, counters: Record<string, number>) => void;
type Result = { eventData: Row[]; records: Row[] };
type Input = {
  records: Row[];
  buildUndo?: boolean;
  persist: (records: Row[]) => Promise<{ events: Row[]; totalUpdated: number }>;
  appendUndo: (undo: unknown[], redo: unknown[]) => Promise<void>;
  afterCommit: () => Promise<void>;
};

type FixtureService = { update(input: Input): Promise<Result> };

function fixtureService(observer?: Observer, load?: () => unknown): FixtureService {
  const { code } = instrumentBulkUpdateSource(fixture);
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(`${compiled}\nnew RecordBulkUpdateService();`, {
    __TEABLE_RECORD_UPDATE_RETENTION__: observer,
    summarizeExplicitUpdates: (records: Row[]) => ({ recordCount: records.length }),
    traceRecordBulkUpdatePhase: async (
      _context: unknown,
      phase: string,
      _attributes: unknown,
      work: () => unknown
    ) => (phase === 'loadExplicitCurrentRecords' && load ? load() : await work()),
  }) as FixtureService;
}

describe('bulk-update retention observation', () => {
  it('observes completed async phases without changing result identities or commit order', async () => {
    const order: string[] = [];
    const inputRows = [{ id: 'a' }, { id: 'b' }];
    const persistedEvents = [
      { id: 'persisted-a', fields: { value: 'a' } },
      { id: 'persisted-b', fields: { value: 'b' } },
    ];
    const { promise: persistGate, resolve: releasePersist } = Promise.withResolvers<void>();
    const seen: Array<{ stage: string; roots: Roots; counters: Record<string, number> }> = [];
    const service = fixtureService((stage, roots, counters) => {
      order.push(stage);
      // Copy only container metadata: root identity is intentionally preserved.
      seen.push({ stage, roots, counters });
    });
    const { promise: started, resolve: persistenceStarted } = Promise.withResolvers<void>();
    const pending = service.update({
      records: inputRows,
      persist: async (batch) => {
        expect(batch[0]).toBe(inputRows[0]);
        order.push('persist:start');
        persistenceStarted();
        await persistGate;
        order.push('persist:end');
        return { events: persistedEvents, totalUpdated: batch.length };
      },
      appendUndo: async () => {
        order.push('undo:append');
      },
      afterCommit: async () => {
        order.push('afterCommit');
      },
    });
    await started;
    expect(order).toEqual([
      'loaded',
      'batchPrepared',
      'batchPrepared',
      'prepared',
      'persist:start',
    ]);
    releasePersist();
    const result = await pending;
    expect(order).toEqual([
      'loaded',
      'batchPrepared',
      'batchPrepared',
      'prepared',
      'persist:start',
      'persist:end',
      'persisted',
      'eventsBuilt',
      'resultBuilt',
      'undoReady',
      'undo:append',
      'undoAppended',
      'afterCommit',
    ]);
    expect(result.records[0]).toBe(inputRows[0]);
    expect(result.eventData[0]).toBe(persistedEvents[0]);
    expect(seen.find(({ stage }) => stage === 'loaded')!.roots.inputRecords).toBe(inputRows);
    expect(seen.find(({ stage }) => stage === 'persisted')!.counters.updatedRows).toBe(2);
    const events = seen.find(({ stage }) => stage === 'eventsBuilt')!;
    expect(events.counters.eventRows).toBe(2);
    expect(events.roots).not.toHaveProperty('persistedBatches');
    expect(events.roots).not.toHaveProperty('fillLinkTitleSpecs');
    const built = seen.find(({ stage }) => stage === 'resultBuilt')!;
    expect(built.roots.materializedRecords).toBe(result.records);
    expect(built.roots).not.toHaveProperty('persistResult');
  });

  it.each([true, false])(
    'counts constructed payloads before append without inferring them from events (buildUndo=%s)',
    async (buildUndo) => {
      const eventRows = [
        { id: 'a', fields: { first: null, second: 'changed' } },
        { id: 'b', fields: { first: 'changed' } },
      ];
      let appended = false;
      const checkpoints: Record<string, number>[] = [];
      const service = fixtureService((stage, _roots, counters) => {
        if (stage !== 'undoReady') return;
        expect(appended).toBe(false);
        checkpoints.push(counters);
      });
      await service.update({
        records: eventRows,
        buildUndo,
        persist: async (records) => ({ events: records, totalUpdated: records.length }),
        appendUndo: async () => {
          appended = true;
        },
        afterCommit: async () => {},
      });
      expect(checkpoints).toEqual([
        {
          undoCommands: buildUndo ? 1 : 0,
          redoCommands: buildUndo ? 1 : 0,
          undoRecordRows: buildUndo ? 2 : 0,
          redoRecordRows: buildUndo ? 2 : 0,
          undoFieldAssignments: buildUndo ? 3 : 0,
          redoFieldAssignments: buildUndo ? 3 : 0,
          eventRows: 2,
        },
      ]);
      expect(appended).toBe(buildUndo);
    }
  );

  it('preserves the empty-input early return without touching out-of-scope roots', async () => {
    const stages: string[] = [];
    const result = await fixtureService((stage) => stages.push(stage)).update({
      records: [],
      persist: async () => {
        throw new Error('empty input must not persist');
      },
      appendUndo: async () => {
        throw new Error('empty input must not append undo');
      },
      afterCommit: async () => {
        stages.push('afterCommit');
      },
    });
    expect(result.records).toEqual([]);
    expect(stages).toEqual(['loaded', 'undoReady', 'undoAppended', 'afterCommit']);
  });

  it('does not evaluate probe arguments when the optional observer is absent', async () => {
    const result = await fixtureService(undefined, () => ({
      get records(): never {
        throw new Error('probe-only loaded-row counter was evaluated');
      },
    })).update({
      records: [{ id: 'a' }],
      persist: async (records) => ({ events: records, totalUpdated: records.length }),
      appendUndo: async () => {},
      afterCommit: async () => {},
    });
    expect(result.records[0]!.id).toBe('a');
  });

  it('fails closed when a known anchor disappears', () => {
    expect(() =>
      instrumentBulkUpdateSource(fixture.replace('const currentRecordsResult =', 'const loaded ='))
    ).toThrow(/currentRecordsResult.*found 0/);
  });

  it('fails closed when an anchor becomes ambiguous', () => {
    expect(() =>
      instrumentBulkUpdateSource(
        fixture.replace(
          'const currentRecordsResult =',
          'const currentRecordsResult = {};\n    const currentRecordsResult ='
        )
      )
    ).toThrow(/currentRecordsResult.*found 2/);
  });

  it('fails closed when persistence no longer uses the expected phase', () => {
    expect(() =>
      instrumentBulkUpdateSource(fixture.replace("'updateManyStream'", "'differentPersistence'"))
    ).toThrow(/persistResult.*updateManyStream/);
  });

  it('rejects persistence that is no longer awaited before the observation', () => {
    expect(() =>
      instrumentBulkUpdateSource(
        fixture.replace(
          'const persistResult = await traceRecordBulkUpdatePhase(',
          'const persistResult = traceRecordBulkUpdatePhase('
        )
      )
    ).toThrow(/persistResult/);
  });

  it('fails closed if a retained root moves into a sibling lexical scope', () => {
    expect(() =>
      instrumentBulkUpdateSource(
        fixture.replace('const pendingEventData = [];', '{ const pendingEventData = []; }')
      )
    ).toThrow(/batchPrepared.*not in scope: pendingEventData/);
  });

  it('rejects already-instrumented input rather than doubling intrusive observations', () => {
    const transformed = instrumentBulkUpdateSource(fixture);
    expect(() => instrumentBulkUpdateSource(transformed.code)).toThrow(
      /already contains retention probes/
    );
  });

  it('leaves other worktrees, generated output and unrelated modules untouched', () => {
    const plugin = recordUpdateRetentionPlugin(true);
    const actualTarget = fileURLToPath(
      new URL('../../../core/src/application/services/RecordBulkUpdateService.ts', import.meta.url)
    );
    for (const id of [
      `/another-worktree${actualTarget}`,
      actualTarget.replace('/src/', '/dist/'),
      `${actualTarget}.backup`,
      'RecordBulkUpdateService.ts',
      '/unrelated.ts?RecordBulkUpdateService.ts',
    ]) {
      expect(plugin.transform('not even valid TypeScript', id)).toBeNull();
    }
    expect(recordUpdateRetentionPlugin(false).transform('invalid', actualTarget)).toBeNull();
  });
});
