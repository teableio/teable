/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const thresholdConfig = registerAs('threshold', () => ({
  maxCopyCells: Number(process.env.MAX_COPY_CELLS ?? 50_000),
  maxResetCells: Number(process.env.MAX_RESET_CELLS ?? 50_000),
  maxPasteCells: Number(process.env.MAX_PASTE_CELLS ?? 50_000),
  maxReadRows: Number(process.env.MAX_READ_ROWS ?? 10_000),
  maxDeleteRows: Number(process.env.MAX_DELETE_ROWS ?? 1_000),
  maxSyncUpdateCells: Number(process.env.MAX_SYNC_UPDATE_CELLS ?? 10_000),
  maxGroupPoints: Number(process.env.MAX_GROUP_POINTS ?? 5_000),
  calcChunkSize: Number(process.env.CALC_CHUNK_SIZE ?? 1_000),
  maxFreeRowLimit: Number(process.env.MAX_FREE_ROW_LIMIT ?? 0),
  estimateCalcCelPerMs: Number(process.env.ESTIMATE_CALC_CEL_PER_MS ?? 3),
  maxUndoStackSize: Number(process.env.MAX_UNDO_STACK_SIZE ?? 200),
  undoExpirationTime: Number(process.env.UNDO_EXPIRATION_TIME ?? 86400),
  bigTransactionTimeout: Number(
    process.env.BIG_TRANSACTION_TIMEOUT ?? 10 * 60 * 1000 /* 10 mins */
  ),
  automationGap: Number(process.env.AUTOMATION_GAP ?? 200),
  maxAttachmentUploadSize: Number(process.env.MAX_ATTACHMENT_UPLOAD_SIZE ?? Infinity),
  maxOpenapiAttachmentUploadSize: Number(
    process.env.MAX_OPENAPI_ATTACHMENT_UPLOAD_SIZE ?? Infinity
  ),
  dbDeadlock: {
    maxRetries: Number(process.env.BACKEND_DB_DEADLOCK_MAX_RETRIES ?? 3),
    initialBackoff: Number(process.env.BACKEND_DB_DEADLOCK_INITIAL_BACKOFF ?? 100),
    jitter: Number(process.env.BACKEND_DB_DEADLOCK_JITTER ?? 1.0),
  },
}));

export const ThresholdConfig = () => Inject(thresholdConfig.KEY);

export type IThresholdConfig = ConfigType<typeof thresholdConfig>;
