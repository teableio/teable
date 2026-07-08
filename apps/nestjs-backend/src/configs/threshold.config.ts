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
  // DB statement_timeout (ms) for the search query, so a slow / full-scan search is canceled
  // and its connection released instead of being held for minutes. Tune via SEARCH_TIMEOUT.
  searchTimeout: Number(process.env.SEARCH_TIMEOUT ?? 15_000 /* 15s */),
  automationGap: Number(process.env.AUTOMATION_GAP ?? 200),
  maxAttachmentUploadSize: Number(process.env.MAX_ATTACHMENT_UPLOAD_SIZE ?? Infinity),
  maxOpenapiAttachmentUploadSize: Number(
    process.env.MAX_OPENAPI_ATTACHMENT_UPLOAD_SIZE ?? Infinity
  ),
  webhook: {
    bodyLimitBytes: Number(process.env.WEBHOOK_BODY_LIMIT_BYTES ?? 4 * 1024 * 1024),
    baseRateLimit: Number(process.env.WEBHOOK_BASE_RATE_LIMIT ?? 50),
    workflowRateLimit: Number(process.env.WEBHOOK_WORKFLOW_RATE_LIMIT ?? 2),
  },
  dbDeadlock: {
    maxRetries: Number(process.env.BACKEND_DB_DEADLOCK_MAX_RETRIES ?? 3),
    initialBackoff: Number(process.env.BACKEND_DB_DEADLOCK_INITIAL_BACKOFF ?? 100),
    jitter: Number(process.env.BACKEND_DB_DEADLOCK_JITTER ?? 1.0),
  },
  baseNodeMaxFolderDepth: Number(process.env.BASE_NODE_MAX_FOLDER_DEPTH ?? 2),
  maxFreeOwnedSpaceCount: Number(process.env.MAX_FREE_SPACE_OWNER_COUNT ?? 2),
  changeEmailSendCodeMailRate: Number(process.env.BACKEND_CHANGE_EMAIL_SEND_CODE_MAIL_RATE ?? 30),
  resetPasswordSendMailRate: Number(process.env.BACKEND_RESET_PASSWORD_SEND_MAIL_RATE ?? 30),
  signupVerificationSendCodeMailRate: Number(
    process.env.BACKEND_SIGNUP_VERIFICATION_CODE_RATE_LIMIT_SECONDS ??
      process.env.BACKEND_SIGNUP_VERIFICATION_SEND_CODE_MAIL_RATE ??
      30
  ),
  billing: {
    automationRunGracePeriod: process.env.BILLING_AUTOMATION_RUN_GRACE_PERIOD ?? '3d',
    automationRunNotifyInterval: process.env.BILLING_AUTOMATION_RUN_NOTIFY_INTERVAL ?? '6h',
    anomaly: {
      dailyVelocityMultiplier: Number(process.env.BILLING_ANOMALY_DAILY_VELOCITY_MULTIPLIER ?? 3),
      burstMultiplier: Number(process.env.BILLING_ANOMALY_BURST_MULTIPLIER ?? 5),
      minAbsoluteCreditAmount: Number(
        process.env.BILLING_ANOMALY_MIN_ABSOLUTE_CREDIT_AMOUNT ?? 500
      ),
      minAbsoluteAutomationRuns: Number(
        process.env.BILLING_ANOMALY_MIN_ABSOLUTE_AUTOMATION_RUNS ?? 1000
      ),
      notifyCooldownHours: Number(process.env.BILLING_ANOMALY_NOTIFY_COOLDOWN_HOURS ?? 24),
    },
  },
  automation: {
    maxEmailsPerPoll: Number(process.env.AUTOMATION_MAX_EMAILS_PER_POLL ?? 100),
    maxEmailDedupWindowSize: Number(process.env.AUTOMATION_MAX_EMAIL_DEDUP_WINDOW_SIZE ?? 500),
    httpRequestTimeout: Number(process.env.AUTOMATION_HTTP_REQUEST_TIMEOUT ?? 300_000), // 5 mins
    watchdogDisabled: process.env.AUTOMATION_WATCHDOG_DISABLED === 'true',
  },
}));

export const ThresholdConfig = () => Inject(thresholdConfig.KEY);

export type IThresholdConfig = ConfigType<typeof thresholdConfig>;
