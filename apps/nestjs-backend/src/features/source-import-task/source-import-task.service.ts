import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { getRandomString, HttpErrorCode } from '@teable/core';
import type { IImportTaskProgress, IImportTaskStatus, IImportTaskSubmitVo } from '@teable/openapi';
import { CacheService } from '../../cache/cache.service';
import { CustomHttpException } from '../../custom.exception';

export type SourceImportTaskSource = 'airtable' | 'google-sheet';

export interface ISourceImportTaskFailure {
  message: string;
  [key: string]: unknown;
}

/** What the cache keeps for one import task. */
export interface ISourceImportTaskState {
  id: string;
  source: SourceImportTaskSource;
  userId: string;
  status: IImportTaskStatus;
  /** Digest of the whole request: tells a repeat of the same import from a different one. */
  fingerprint: string;
  baseId?: string;
  progress?: IImportTaskProgress;
  result?: unknown;
  error?: ISourceImportTaskFailure;
  createdAt: number;
  /** Refreshed by the heartbeat while running; a running task that stops beating was cut off. */
  updatedAt: number;
}

export interface ISourceImportTaskVo<TResult = unknown> {
  taskId: string;
  status: IImportTaskStatus;
  baseId?: string;
  progress?: IImportTaskProgress;
  result?: TResult;
  error?: ISourceImportTaskFailure;
  createdTime: string;
  lastModifiedTime: string;
}

export type ISourceImportTaskProgressReporter = (progress: IImportTaskProgress) => void;

export interface ISourceImportTaskSubmitInput<TResult> {
  source: SourceImportTaskSource;
  userId: string;
  /**
   * What makes two imports "the same one" while one of them is still running:
   * the source and where it goes, not the import options.
   */
  scope: unknown;
  /** The whole request without credentials. */
  fingerprint: unknown;
  force?: boolean;
  /**
   * `setBaseId` takes the base the import writes into the moment that base
   * exists, so a failed or interrupted task can always say where its data is.
   */
  run: (
    report: ISourceImportTaskProgressReporter,
    setBaseId: (baseId: string) => void
  ) => Promise<TResult>;
  /**
   * Turns whatever the import threw into what the task reports. `baseId`
   * corrects the base given to `setBaseId`: the base the failed import left
   * behind, or null when it left none.
   */
  toFailure: (error: unknown) => { error: ISourceImportTaskFailure; baseId?: string | null };
}

type ISourceImportTaskOutcome = Pick<
  ISourceImportTaskState,
  'status' | 'result' | 'error' | 'baseId'
>;

interface IActiveTask {
  state: ISourceImportTaskState;
  slotKey: `lock:${string}`;
  dirty: boolean;
  settled: boolean;
  lastBeatAt: number;
  /** The cache write in flight, so the final state is always written last. */
  writing?: Promise<void>;
}

export const SOURCE_IMPORT_TASK_TIMING = {
  /** How often a changed progress is flushed to the cache. */
  flushMs: 2_000,
  /** How often a running task proves it is alive and renews its slot. */
  heartbeatMs: 10_000,
  /** A running task silent for this long is reported as interrupted. */
  staleMs: 45_000,
  /** Outlives staleMs, so a dead import frees its slot shortly after it is reported dead. */
  slotTtlSeconds: 60,
  /** How long repeating a finished import returns that import instead of running it again. */
  completedDedupeSeconds: 10 * 60,
  stateTtlSeconds: 24 * 60 * 60,
} as const;

const maxClaimAttempts = 3;
const finalWriteAttempts = 3;
const taskIdPattern = /^imt[0-9a-zA-Z]{16}$/;

const interruptedMessage =
  'The import was interrupted before it finished (the server stopped or restarted). ' +
  'Whatever it had already imported was kept.';

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
};

const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(sortKeys(value)))
    .digest('hex');

const taskKey = (taskId: string) => `import:source-task:${taskId}` as const;

/**
 * Runs a source import (Airtable, Google Sheets) in the background of the
 * process that accepted it and keeps its state in the cache, so any instance
 * can answer a status poll.
 *
 * An import cannot be resumed, so nothing here retries one: the point is that
 * the client no longer has to hold a connection open for the whole import, and
 * that asking for the same import twice does not run it twice.
 */
@Injectable()
export class SourceImportTaskService {
  private readonly logger = new Logger(SourceImportTaskService.name);

  constructor(private readonly cacheService: CacheService) {}

  async submit<TResult>(
    input: ISourceImportTaskSubmitInput<TResult>
  ): Promise<IImportTaskSubmitVo> {
    const slotKey =
      `lock:source-import:${digest([input.source, input.userId, input.scope])}` as const;
    const fingerprint = digest(input.fingerprint);

    for (let attempt = 0; attempt < maxClaimAttempts; attempt++) {
      const now = Date.now();
      const state: ISourceImportTaskState = {
        id: `imt${getRandomString(16)}`,
        source: input.source,
        userId: input.userId,
        status: 'running',
        fingerprint,
        createdAt: now,
        updatedAt: now,
      };
      // The state goes in before the slot is claimed, so whoever finds the slot
      // taken can always read the task that holds it.
      await this.write(state);
      if (
        await this.cacheService.setnx(slotKey, state.id, SOURCE_IMPORT_TASK_TIMING.slotTtlSeconds)
      ) {
        this.run({ state, slotKey, dirty: false, settled: false, lastBeatAt: now }, input);
        return { taskId: state.id, status: 'running', reused: false };
      }
      await this.cacheService.del(taskKey(state.id));

      const holderId = await this.cacheService.get(slotKey);
      if (!holderId) continue;
      const holder = await this.read(holderId);
      const isRepeatOfFinished =
        holder?.status === 'completed' && !input.force && holder.fingerprint === fingerprint;
      if (holder && (holder.status === 'running' || isRepeatOfFinished)) {
        // A retry with other options still joins the running import (running it a
        // second time is the worse outcome), so the caller is told they did not apply.
        return {
          taskId: holder.id,
          status: holder.status,
          reused: true,
          sameOptions: holder.fingerprint === fingerprint,
        };
      }
      // The holder failed, was cut off, or finished a different request: free
      // its slot (only if it is still the holder) and claim again.
      await this.cacheService.releaseLock(slotKey, holderId);
    }

    throw new CustomHttpException(
      'Another import of the same source is starting right now. Try again in a moment.',
      HttpErrorCode.TOO_MANY_REQUESTS,
      { localization: { i18nKey: 'httpErrors.tooManyRequests' } }
    );
  }

  async get<TResult>(
    source: SourceImportTaskSource,
    userId: string,
    taskId: string
  ): Promise<ISourceImportTaskVo<TResult>> {
    const state = taskIdPattern.test(taskId) ? await this.read(taskId) : undefined;
    // Someone else's task is reported exactly like a missing one.
    if (!state || state.source !== source || state.userId !== userId) {
      throw new CustomHttpException(
        'Import task not found. It may have expired.',
        HttpErrorCode.NOT_FOUND
      );
    }
    return {
      taskId: state.id,
      status: state.status,
      ...(state.baseId ? { baseId: state.baseId } : {}),
      ...(state.progress ? { progress: state.progress } : {}),
      ...(state.status === 'completed' ? { result: state.result as TResult } : {}),
      ...(state.status === 'failed' && state.error ? { error: state.error } : {}),
      createdTime: new Date(state.createdAt).toISOString(),
      lastModifiedTime: new Date(state.updatedAt).toISOString(),
    };
  }

  private async read(taskId: string): Promise<ISourceImportTaskState | undefined> {
    const state = await this.cacheService.get(taskKey(taskId));
    if (!state) return undefined;
    if (
      state.status === 'running' &&
      Date.now() - state.updatedAt > SOURCE_IMPORT_TASK_TIMING.staleMs
    ) {
      // Its process is gone: nothing will ever finish this task.
      return { ...state, status: 'failed', error: { message: interruptedMessage } };
    }
    return state;
  }

  private async write(state: ISourceImportTaskState): Promise<void> {
    await this.cacheService.setDetail(
      taskKey(state.id),
      state,
      SOURCE_IMPORT_TASK_TIMING.stateTtlSeconds
    );
  }

  /**
   * Starts the import without awaiting it. It keeps running in the request's
   * async context (user, permissions, audit) after the response has been sent.
   */
  private run<TResult>(active: IActiveTask, input: ISourceImportTaskSubmitInput<TResult>): void {
    const timer = setInterval(() => this.tick(active), SOURCE_IMPORT_TASK_TIMING.flushMs);
    timer.unref();

    const report: ISourceImportTaskProgressReporter = (progress) => {
      if (active.settled) return;
      active.state.progress = { ...progress };
      active.dirty = true;
    };
    const setBaseId = (baseId: string) => {
      if (active.settled) return;
      active.state.baseId = baseId;
      active.dirty = true;
    };

    void (async () => {
      let outcome: Partial<ISourceImportTaskOutcome> & Pick<ISourceImportTaskOutcome, 'status'>;
      try {
        outcome = { status: 'completed', result: await input.run(report, setBaseId) };
      } catch (error) {
        try {
          const failure = input.toFailure(error);
          outcome = {
            status: 'failed',
            error: failure.error,
            ...(failure.baseId === undefined ? {} : { baseId: failure.baseId ?? undefined }),
          };
        } catch (describeError) {
          this.logger.error(
            `[import-task] ${active.state.id} could not describe its failure`,
            describeError
          );
          outcome = { status: 'failed', error: { message: 'Unknown import error' } };
        }
      }
      active.settled = true;
      clearInterval(timer);
      await this.settle(active, outcome);
    })().catch((error) => {
      // Nothing awaits the import: an escaped rejection would take the process down.
      clearInterval(timer);
      this.logger.error(`[import-task] ${active.state.id} ended unexpectedly`, error);
    });
  }

  /** Flushes a changed progress and, every heartbeat, proves the task alive and renews its slot. */
  private tick(active: IActiveTask): void {
    if (active.settled || active.writing) return;
    const now = Date.now();
    const isBeat = now - active.lastBeatAt >= SOURCE_IMPORT_TASK_TIMING.heartbeatMs;
    if (!active.dirty && !isBeat) return;

    active.dirty = false;
    active.state.updatedAt = now;
    // A copy: the task may settle and change the state while this write is in flight.
    const snapshot = { ...active.state };
    active.writing = (async () => {
      try {
        await this.write(snapshot);
        if (isBeat) {
          active.lastBeatAt = now;
          await this.keepSlot(active);
        }
      } catch (error) {
        // A cache hiccup must not take the import down with it.
        this.logger.warn(`[import-task] ${active.state.id} heartbeat failed`, error);
        active.dirty = true;
      } finally {
        active.writing = undefined;
      }
    })();
  }

  private async keepSlot({ slotKey, state }: IActiveTask): Promise<void> {
    const { slotTtlSeconds } = SOURCE_IMPORT_TASK_TIMING;
    if (await this.cacheService.renewLock(slotKey, state.id, slotTtlSeconds)) return;
    // The slot expired under a stalled heartbeat. Take it back unless another import has it.
    const retaken = await this.cacheService.setnx(slotKey, state.id, slotTtlSeconds);
    this.logger.warn(
      `[import-task] ${state.id} lost its slot (${retaken ? 'taken back' : 'now held by another import'})`
    );
  }

  private async settle(
    active: IActiveTask,
    outcome: Partial<ISourceImportTaskOutcome> & Pick<ISourceImportTaskOutcome, 'status'>
  ): Promise<void> {
    // No new write starts once the task is settled; let the one in flight land first.
    await active.writing;
    const state: ISourceImportTaskState = { ...active.state, ...outcome, updatedAt: Date.now() };

    for (let attempt = 1; attempt <= finalWriteAttempts; attempt++) {
      try {
        await this.write(state);
        break;
      } catch (error) {
        if (attempt === finalWriteAttempts) {
          // Polls will report it as interrupted: the heartbeat has stopped.
          this.logger.error(
            `[import-task] ${state.id} finished as "${state.status}" but its result could not be stored`,
            error
          );
        } else {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }

    try {
      if (state.status === 'completed') {
        // Keep the slot for a while: repeating the request returns this result.
        await this.cacheService.renewLock(
          active.slotKey,
          state.id,
          SOURCE_IMPORT_TASK_TIMING.completedDedupeSeconds
        );
      } else {
        await this.cacheService.releaseLock(active.slotKey, state.id);
      }
    } catch (error) {
      this.logger.warn(`[import-task] ${state.id} could not update its slot`, error);
    }
  }
}
