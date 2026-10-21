export const COMPUTED_OUTBOX_WAKEUP_QUEUE = 'v2-computed-outbox-wakeup';
export const COMPUTED_OUTBOX_WAKEUP_JOB = 'computed-outbox-wakeup';
export const COMPUTED_OUTBOX_WAKEUP_PUBLISHER = Symbol('computedOutboxWakeupPublisher');
export const COMPUTED_OUTBOX_ADMIN = Symbol('computedOutboxAdmin');
export const COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT = 2000;
export const COMPUTED_OUTBOX_FAILED_RETENTION_COUNT = 5000;
export const COMPUTED_OUTBOX_RECENT_COMPLETED_LIMIT = 10;
export const COMPUTED_OUTBOX_RECENT_FAILED_LIMIT = 10;
export const COMPUTED_OUTBOX_JOB_SCAN_LIMIT = 1000;

export const COMPUTED_OUTBOX_ANOMALY_FETCH_CAP = 2000;
