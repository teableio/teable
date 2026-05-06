import * as Sentry from '@sentry/nestjs';
import type * as V2AdapterTableRepositoryPostgres from '@teable/v2-adapter-table-repository-postgres';
import type { ITracer, Table } from '@teable/v2-core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { IntegrityV2Service } from './integrity-v2.service';

type IMetaValidationIssue = V2AdapterTableRepositoryPostgres.MetaValidationIssue;
type ISchemaRepairResult = V2AdapterTableRepositoryPostgres.SchemaRepairResult;

const schemaIntegrityRepairFeatureTag = 'schema-integrity-repair';
const repairRuleId = 'column:fldIntegrity0001';
const metaFieldId = 'fldIntegrity0001';
const metaReferenceRuleId = 'meta:reference';
const repairFailureSpanName = 'teable.IntegrityV2Service.reportRepairFailure';
const integrityFailureKindAttribute = 'teable.integrity.failure_kind';
const integrityRuleIdAttribute = 'teable.integrity.rule_id';
const integrityScopeAttribute = 'teable.integrity.scope';
const integrityTargetIdAttribute = 'teable.integrity.target_id';
const repairStreamCrashedMessage = 'repair stream crashed';
const createThrowingRepairStream = (message: string): AsyncGenerator<ISchemaRepairResult> =>
  ({
    async next() {
      throw new Error(message);
    },
    async return() {
      return {
        done: true,
        value: undefined,
      };
    },
    async throw(error) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  }) as AsyncGenerator<ISchemaRepairResult>;

class FakeSpan {
  name: string;
  attributes?: Record<string, string | number | boolean>;
  errors: string[] = [];
  ended = false;

  constructor(name: string, attributes?: Record<string, string | number | boolean>) {
    this.name = name;
    this.attributes = attributes;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes = {
      ...(this.attributes ?? {}),
      [key]: value,
    };
  }

  setAttributes(attributes: Record<string, string | number | boolean>): void {
    this.attributes = {
      ...(this.attributes ?? {}),
      ...attributes,
    };
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer implements ITracer {
  spans: FakeSpan[] = [];

  startSpan(name: string, attributes?: Record<string, string | number | boolean>) {
    const span = new FakeSpan(name, attributes);
    this.spans.push(span);
    return span;
  }

  async withSpan<T>(_span: FakeSpan, callback: () => Promise<T>): Promise<T> {
    return await callback();
  }

  getActiveSpan(): FakeSpan | undefined {
    return this.spans.at(-1);
  }
}

const sentryScope = {
  setLevel: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
};

vi.mock('@sentry/nestjs', () => ({
  withScope: (callback: (scope: typeof sentryScope) => void) => callback(sentryScope),
  captureException: vi.fn(),
}));

const createTable = (fields: unknown[] = []): Table =>
  ({
    id: () => ({ toString: () => 'tblIntegrity000001' }),
    name: () => ({ toString: () => 'Tasks' }),
    baseId: () => ({ toString: () => 'baseIntegrity0001' }),
    getFields: () => fields,
  }) as unknown as Table;

const createMetaIssue = (): IMetaValidationIssue => ({
  fieldId: metaFieldId,
  fieldName: 'Status',
  fieldType: 'lookup',
  category: 'reference',
  severity: 'error',
  message: 'Link field not found: fldMissing',
  details: {
    relatedFieldId: 'fldMissing',
  },
});

const createMetaIssueStream = (issue: IMetaValidationIssue): AsyncGenerator<IMetaValidationIssue> =>
  (async function* () {
    yield issue;
  })();

const createRepairResult = (): ISchemaRepairResult => ({
  id: 'tblIntegrity000001:rule:error',
  fieldId: metaFieldId,
  fieldName: 'Status',
  ruleId: repairRuleId,
  ruleDescription: 'Physical column "Status" (text)',
  status: 'error',
  outcome: 'unchanged',
  message: 'Schema repair failed',
  required: true,
  timestamp: Date.now(),
  dependencies: [],
  depth: 0,
  details: {
    statementCount: 1,
  },
});

const collect = async <T>(stream: AsyncGenerator<T, void, unknown>): Promise<T[]> => {
  const results: T[] = [];
  for await (const item of stream) {
    results.push(item);
  }
  return results;
};

describe('IntegrityV2Service repair telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks metadata reference check results as auto repairable', async () => {
    const service = new IntegrityV2Service({} as never, {} as never);
    const table = createTable();
    const issue = createMetaIssue();

    const stream = service['decorateMetaCheckStream'](
      table,
      createMetaIssueStream(issue),
      undefined
    );

    const results = await collect(stream);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      fieldId: issue.fieldId,
      ruleId: metaReferenceRuleId,
      status: 'error',
      repair: {
        available: true,
        mode: 'auto',
      },
    });
  });

  it('captures result-level repair failures to sentry and trace spans', async () => {
    const service = new IntegrityV2Service({} as never, {} as never);
    const tracer = new FakeTracer();
    const table = createTable();
    const result = createRepairResult();

    const stream = service['decorateRepairStream'](
      table,
      (async function* () {
        yield result;
      })(),
      undefined,
      {
        tracer,
        scope: 'table',
        targetId: table.id().toString(),
      }
    );

    const serialized = await collect(stream);

    expect(serialized).toHaveLength(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentryScope.setTag).toHaveBeenCalledWith('feature', schemaIntegrityRepairFeatureTag);
    expect(sentryScope.setTag).toHaveBeenCalledWith('integrity.failure_kind', 'result_error');
    expect(sentryScope.setContext).toHaveBeenCalledWith(
      'schema-integrity-repair',
      expect.objectContaining({
        tableId: 'tblIntegrity000001',
        ruleId: repairRuleId,
        failureKind: 'result_error',
      })
    );
    expect(tracer.spans[0]?.name).toBe(repairFailureSpanName);
    expect(tracer.spans[0]?.attributes).toMatchObject({
      [integrityFailureKindAttribute]: 'result_error',
      [integrityRuleIdAttribute]: repairRuleId,
      [integrityScopeAttribute]: 'table',
    });
    expect(tracer.spans[0]?.errors).toContain('Schema repair failed');
  });

  it('captures thrown repair stream exceptions to sentry and trace spans', async () => {
    const service = new IntegrityV2Service({} as never, {} as never);
    const tracer = new FakeTracer();
    const table = createTable();

    const stream = service['decorateRepairStream'](
      table,
      createThrowingRepairStream(repairStreamCrashedMessage),
      undefined,
      {
        tracer,
        scope: 'base',
        targetId: table.baseId().toString(),
      }
    );

    await expect(collect(stream)).rejects.toThrow(repairStreamCrashedMessage);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentryScope.setTag).toHaveBeenCalledWith('integrity.failure_kind', 'stream_exception');
    expect(tracer.spans[0]?.attributes).toMatchObject({
      [integrityFailureKindAttribute]: 'stream_exception',
      [integrityScopeAttribute]: 'base',
      [integrityTargetIdAttribute]: 'baseIntegrity0001',
    });
    expect(tracer.spans[0]?.errors).toContain(repairStreamCrashedMessage);
  });
});
