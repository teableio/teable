import type { IExecutionContext, IRealtimeEngine } from '@teable/v2-core';
import type { IHeadlessRuntime } from '@teable/v2-headless-runtime';
import {
  baseVcsPatchSchema,
  baseVcsSnapshotSchema,
  diffComputedImpact,
  vcsHydrateRecordsBodySchema,
  type DomainError,
  type IBaseVcsPatch,
} from '@teable/v2-vcs';
import { V2EngineSyncAdapter } from '@teable/v2-vcs/engine';
import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const mapDomainErrorStatus = (error: DomainError): ContentfulStatusCode => {
  if (error.tags.includes('not-found')) return 404;
  if (error.tags.includes('forbidden')) return 403;
  if (error.tags.includes('unauthorized')) return 401;
  if (error.tags.includes('conflict')) return 409;
  if (error.tags.includes('validation') || error.tags.includes('invariant')) return 400;
  return 500;
};

const toErrorEnvelope = (error: DomainError) => ({
  ok: false as const,
  error: {
    code: error.code ?? 'vcs.engine_error',
    message: error.message,
    tags: error.tags,
  },
});

const validationError = (code: string, message: string) => ({
  ok: false as const,
  error: {
    code,
    message,
    tags: ['validation'] as const,
  },
});

const APPLY_BOOLEAN_FLAGS = [
  ['includeSnapshot', 'validation.include_snapshot.invalid'],
  ['skipCaptureSnapshot', 'validation.skip_capture_snapshot.invalid'],
  ['diffComputedImpact', 'validation.diff_computed_impact.invalid'],
] as const;

const parseApplyVcsPatchBody = (
  rawBody: unknown
):
  | { error: ReturnType<typeof validationError> }
  | {
      baseId: string;
      patch: IBaseVcsPatch;
      includeImpact: boolean;
      skipCaptureSnapshot: boolean;
    } => {
  if (!isRecord(rawBody) || typeof rawBody.baseId !== 'string' || rawBody.baseId.length === 0) {
    return {
      error: validationError(
        'validation.base_id.invalid',
        'Request body baseId must be a non-empty string'
      ),
    };
  }
  for (const [key, code] of APPLY_BOOLEAN_FLAGS) {
    if (rawBody[key] !== undefined && typeof rawBody[key] !== 'boolean') {
      return { error: validationError(code, `${key} must be a boolean`) };
    }
  }
  const parsedPatch = baseVcsPatchSchema.safeParse(rawBody.patch);
  if (!parsedPatch.success) {
    return {
      error: validationError(
        'validation.patch.invalid',
        parsedPatch.error.issues[0]?.message ?? 'Invalid patch'
      ),
    };
  }
  const includeImpact = rawBody.diffComputedImpact === true;
  const skipCaptureSnapshot =
    !includeImpact && (rawBody.skipCaptureSnapshot === true || rawBody.includeSnapshot === false);
  return {
    baseId: rawBody.baseId,
    patch: parsedPatch.data,
    includeImpact,
    skipCaptureSnapshot,
  };
};

export const registerHeadlessVcsRoutes = <TRealtime extends IRealtimeEngine>(
  app: Hono,
  runtime: IHeadlessRuntime<TRealtime>,
  getExecutionContext: () => IExecutionContext
): void => {
  const engineAdapter = new V2EngineSyncAdapter({
    commandBus: runtime.commandBus,
    queryBus: runtime.queryBus,
    getExecutionContext,
    flushComputed: async () => {
      await runtime.flushComputed();
    },
    ...(runtime.queryRaw ? { queryRaw: (sql, params) => runtime.queryRaw!(sql, params) } : {}),
  });

  app.get('/vcs/exists', async (c) => {
    const baseId = c.req.query('baseId')?.trim();
    if (!baseId) {
      return c.json(
        validationError('validation.base_id.required', 'Query baseId is required'),
        400
      );
    }

    const result = await engineAdapter.hasBase(baseId);
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json({ ok: true as const, data: { exists: result.value } }, 200);
  });

  app.get('/vcs/snapshot', async (c) => {
    const baseId = c.req.query('baseId');
    if (!baseId) {
      return c.json(
        validationError('validation.base_id.required', 'Query baseId is required'),
        400
      );
    }

    const baseName = c.req.query('baseName') || undefined;
    const rawRevision = c.req.query('revision');
    let revision: number | undefined;
    if (rawRevision !== undefined && rawRevision !== '') {
      revision = Number(rawRevision);
      if (!Number.isInteger(revision) || revision < 0) {
        return c.json(
          validationError(
            'validation.revision.invalid',
            'Query revision must be a non-negative integer'
          ),
          400
        );
      }
    }

    const result = await engineAdapter.captureSnapshot(baseId, {
      ...(baseName ? { baseName } : {}),
      ...(revision !== undefined ? { revision } : {}),
    });

    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json({ ok: true as const, data: result.value }, 200);
  });

  app.post('/vcs/hydrate', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(validationError('validation.json.invalid', 'Invalid JSON body'), 400);
    }

    if (!isRecord(rawBody) || !('snapshot' in rawBody)) {
      return c.json(
        validationError('validation.snapshot.invalid', 'Request body must include snapshot'),
        400
      );
    }

    const parsed = baseVcsSnapshotSchema.safeParse(rawBody.snapshot);
    if (!parsed.success) {
      return c.json(
        validationError(
          'validation.snapshot.invalid',
          parsed.error.issues[0]?.message ?? 'Invalid snapshot'
        ),
        400
      );
    }

    const skipCaptureSnapshot = rawBody.skipCaptureSnapshot === true;
    const result = await engineAdapter.hydrateSnapshot(parsed.data, {
      skipCaptureSnapshot,
    });
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json({ ok: true as const, data: result.value }, 200);
  });

  app.post('/vcs/apply', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(validationError('validation.json.invalid', 'Invalid JSON body'), 400);
    }

    const parsed = parseApplyVcsPatchBody(rawBody);
    if ('error' in parsed) {
      return c.json(parsed.error, 400);
    }

    const { baseId, patch, includeImpact, skipCaptureSnapshot } = parsed;
    const beforeSnapshot = includeImpact ? await engineAdapter.captureSnapshot(baseId) : undefined;

    const result = await engineAdapter.applyPatch(baseId, patch, { skipCaptureSnapshot });
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    if (includeImpact && beforeSnapshot?.isOk() && result.value.snapshot) {
      const impact = diffComputedImpact(beforeSnapshot.value, result.value.snapshot);
      return c.json(
        {
          ok: true as const,
          data: {
            ...result.value,
            recomputedCells: impact.totalAffectedCells,
            computedImpact: impact,
          },
        },
        200
      );
    }

    return c.json({ ok: true as const, data: result.value }, 200);
  });

  app.post('/vcs/hydrate-records', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(validationError('validation.json.invalid', 'Invalid JSON body'), 400);
    }

    const parsed = vcsHydrateRecordsBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        validationError(
          'validation.hydrate_records.invalid',
          parsed.error.issues[0]?.message ?? 'Invalid hydrate-records payload'
        ),
        400
      );
    }

    const result = await engineAdapter.hydrateRecordChunk(parsed.data);
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json({ ok: true as const, data: result.value }, 200);
  });

  app.post('/vcs/flush-computed', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(validationError('validation.json.invalid', 'Invalid JSON body'), 400);
    }

    if (!isRecord(rawBody) || typeof rawBody.baseId !== 'string' || rawBody.baseId.length === 0) {
      return c.json(
        validationError(
          'validation.base_id.invalid',
          'Request body baseId must be a non-empty string'
        ),
        400
      );
    }

    const result = await engineAdapter.flushComputed(rawBody.baseId);
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json({ ok: true as const, data: { recomputedCells: result.value } }, 200);
  });

  app.get('/vcs/records-chunk', async (c) => {
    const baseId = c.req.query('baseId')?.trim();
    const tableId = c.req.query('tableId')?.trim();
    if (!baseId || !tableId) {
      return c.json(
        validationError('validation.query.invalid', 'Query baseId and tableId are required'),
        400
      );
    }

    const cursor = c.req.query('cursor') || undefined;
    const rawLimit = c.req.query('limit');
    let limit: number | undefined;
    if (rawLimit !== undefined && rawLimit !== '') {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 2000) {
        return c.json(
          validationError('validation.limit.invalid', 'Query limit must be an integer 1..2000'),
          400
        );
      }
    }

    const result = await engineAdapter.captureTableRecordsChunk(baseId, tableId, {
      ...(cursor ? { cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json({ ok: true as const, data: result.value }, 200);
  });

  app.post('/vcs/mark-clean', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(validationError('validation.json.invalid', 'Invalid JSON body'), 400);
    }

    if (!isRecord(rawBody) || typeof rawBody.baseId !== 'string' || rawBody.baseId.length === 0) {
      return c.json(
        validationError(
          'validation.base_id.invalid',
          'Request body baseId must be a non-empty string'
        ),
        400
      );
    }

    const result = await engineAdapter.markWorkingClean(rawBody.baseId);
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json({ ok: true as const, data: { ok: true } }, 200);
  });

  app.post('/vcs/ensure-triggers', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(validationError('validation.json.invalid', 'Invalid JSON body'), 400);
    }

    if (!isRecord(rawBody) || typeof rawBody.baseId !== 'string' || rawBody.baseId.length === 0) {
      return c.json(
        validationError(
          'validation.base_id.invalid',
          'Request body baseId must be a non-empty string'
        ),
        400
      );
    }

    const result = await engineAdapter.ensureWorkingTrackingTriggers(rawBody.baseId);
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json({ ok: true as const, data: { ok: true } }, 200);
  });

  app.get('/vcs/delta', async (c) => {
    const baseId = c.req.query('baseId')?.trim();
    if (!baseId) {
      return c.json(
        validationError('validation.base_id.required', 'Query baseId is required'),
        400
      );
    }

    const baseName = c.req.query('baseName') || undefined;
    const rawRevision = c.req.query('revision');
    let revision: number | undefined;
    if (rawRevision !== undefined && rawRevision !== '') {
      revision = Number(rawRevision);
      if (!Number.isInteger(revision) || revision < 0) {
        return c.json(
          validationError(
            'validation.revision.invalid',
            'Query revision must be a non-negative integer'
          ),
          400
        );
      }
    }

    const result = await engineAdapter.captureWorkingDelta(baseId, {
      ...(baseName ? { baseName } : {}),
      ...(revision !== undefined ? { revision } : {}),
    });
    if (result.isErr()) {
      return c.json(toErrorEnvelope(result.error), mapDomainErrorStatus(result.error));
    }

    return c.json(
      {
        ok: true as const,
        data: {
          isCompleteDelta: result.value.isCompleteDelta,
          schemaSnapshot: result.value.schemaSnapshot,
          tableDeltas: Object.fromEntries(result.value.tableDeltas),
        },
      },
      200
    );
  });
};
