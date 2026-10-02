export const computedOutboxPauseScopeTypes = ['space', 'base', 'table'] as const;
export type ComputedOutboxPauseScopeType = (typeof computedOutboxPauseScopeTypes)[number];
export const computedOutboxPauseWritePolicies = ['allow_bounded', 'block'] as const;
export type ComputedOutboxPauseWritePolicy = (typeof computedOutboxPauseWritePolicies)[number];

/** Writes that require computed propagation while a pause lease uses `block`. Never map this to 503. */
export const COMPUTE_PAUSED_WRITE_BLOCKED_CODE = 'COMPUTE_PAUSED_WRITE_BLOCKED';

export const computedOutboxStorageKinds = ['default', 'byodb'] as const;
export type ComputedOutboxStorageKind = (typeof computedOutboxStorageKinds)[number];

export const computedOutboxAnomalyKinds = ['dead', 'stale'] as const;
export type ComputedOutboxAnomalyKind = (typeof computedOutboxAnomalyKinds)[number];

export const computedOutboxHealthStatuses = ['healthy', 'degraded', 'critical'] as const;
export type ComputedOutboxHealthStatus = (typeof computedOutboxHealthStatuses)[number];

export const computedOutboxHealthReasons = [
  'queue_unavailable',
  'queue_paused',
  'consumer_unavailable',
  'failed_jobs',
  'dead_letters',
  'stale_processing',
  'overdue_pending',
  'paused_backlog',
  'target_unavailable',
] as const;
export type ComputedOutboxHealthReason = (typeof computedOutboxHealthReasons)[number];

export const computedOutboxLedgerStates = ['pending', 'processing', 'dead', 'settled'] as const;
export type ComputedOutboxLedgerState = (typeof computedOutboxLedgerStates)[number];

export const computedOutboxQueueJobStates = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'paused',
  'prioritized',
  'completed',
] as const;
export type ComputedOutboxQueueJobState = (typeof computedOutboxQueueJobStates)[number];

export const computedOutboxQueueJobCauses = ['created', 'merged', 'retry', 'replay'] as const;
export type ComputedOutboxQueueJobCause = (typeof computedOutboxQueueJobCauses)[number];

export const computedOutboxQueueJobOutcomes = ['processed', 'noop', 'deferred', 'parked'] as const;
export type ComputedOutboxQueueJobOutcome = (typeof computedOutboxQueueJobOutcomes)[number];

export const computedOutboxQueueJobViews = ['tasks', 'deliveries'] as const;
export type ComputedOutboxQueueJobView = (typeof computedOutboxQueueJobViews)[number];

export const computedOutboxQueueJobSorts = ['time', 'duration'] as const;
export type ComputedOutboxQueueJobSort = (typeof computedOutboxQueueJobSorts)[number];

export const computedOutboxWakeupDeliveryResults = ['accepted', 'deferred'] as const;
export type ComputedOutboxWakeupDeliveryResult =
  (typeof computedOutboxWakeupDeliveryResults)[number];

export type ComputedOutboxPauseScope = {
  id: string;
  targetId: string;
  storage: ComputedOutboxStorageKind;
  connectionId: string | null;
  scopeType: ComputedOutboxPauseScopeType;
  scopeId: string;
  scopeName: string | null;
  baseId: string | null;
  baseName: string | null;
  spaceId: string | null;
  spaceName: string | null;
  pausedAt: string;
  pausedBy: string | null;
  resumeAt: string | null;
  reason: string | null;
  writePolicy: ComputedOutboxPauseWritePolicy;
  updatedAt: string;
  updatedBy: string | null;
};

export type ComputedOutboxUnavailablePauseTarget = {
  targetId: string;
  storage: ComputedOutboxStorageKind;
  error: string;
};

export type ComputedOutboxPauseList = {
  sampledAt: string;
  total: number;
  unavailableTargetCount: number;
  unavailableTargets: ComputedOutboxUnavailablePauseTarget[];
  scopes: ComputedOutboxPauseScope[];
};

export type ComputedOutboxPauseSpace = {
  spaceId: string;
  spaceName: string;
  storage: ComputedOutboxStorageKind;
  targetId: string;
  bindingState: string | null;
  paused: boolean;
  pauses: ComputedOutboxPauseScope[];
};

export type ComputedOutboxAnomaly = {
  targetId: string;
  storage: ComputedOutboxStorageKind;
  kind: ComputedOutboxAnomalyKind;
  taskId: string;
  baseId: string;
  baseName?: string;
  spaceId?: string;
  spaceName?: string;
  seedTableId: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  failedSql?: string | null;
  failureKind?: string | null;
  failurePhase?: string | null;
  affectedTableName?: string | null;
  occurredAt: Date;
};

export type ComputedOutboxAnomalyGroup = {
  groupKey: string;
  kind: ComputedOutboxAnomalyKind;
  targetId: string;
  storage: ComputedOutboxStorageKind;
  baseId: string;
  baseName?: string;
  spaceId?: string;
  spaceName?: string;
  seedTableId: string;
  lastError: string | null;
  errorSignature: string;
  failedSql?: string | null;
  failureKind?: string | null;
  failurePhase?: string | null;
  affectedTableName?: string | null;
  count: number;
  latestOccurredAt: Date;
  items: ComputedOutboxAnomaly[];
  targetHealth?: string;
};

export type ComputedOutboxAnomalyList = {
  sampledAt: string;
  total: number;
  groupTotal: number;
  matchedGroupTotal: number;
  groups: ComputedOutboxAnomalyGroup[];
  unavailableTargetCount: number;
};

export type ComputedOutboxQueueJob = {
  taskId: string;
  baseId: string;
  baseName?: string;
  spaceId?: string;
  spaceName?: string;
  cause?: ComputedOutboxQueueJobCause;
  state: ComputedOutboxQueueJobState;
  attemptsMade: number;
  createdAt: string;
  availableAt?: string;
  emittedAt?: string;
  scheduledFor?: string;
  startedAt?: string;
  finishedAt?: string;
  processingDurationMs?: number;
  failedReason?: string | null;
  ledgerState?: ComputedOutboxLedgerState;
  outcome?: ComputedOutboxQueueJobOutcome;
  deliveryCount?: number;
};

export type ComputedOutboxQueueJobScan = {
  state: ComputedOutboxQueueJobState;
  scanned: number;
  truncated: boolean;
  missing?: number;
};

export type ComputedOutboxQueueJobScanResult = {
  jobs: ComputedOutboxQueueJob[];
  scan: ComputedOutboxQueueJobScan[];
  error?: string;
};

export type ComputedOutboxQueueJobList = {
  sampledAt: string;
  total: number;
  limit: number;
  offset: number;
  jobs: ComputedOutboxQueueJob[];
  scan: ComputedOutboxQueueJobScan[];
  facets: {
    spaces: Array<{ id: string; name?: string; count: number }>;
    bases: Array<{ id: string; name?: string; spaceId?: string; count: number }>;
    causes: Array<{ cause: ComputedOutboxQueueJobCause; count: number }>;
    outcomes: Array<{ outcome: ComputedOutboxQueueJobOutcome; count: number }>;
  };
  hiddenSettled?: number;
  error?: string;
};

export type ComputedOutboxWorkerConcurrency = {
  processDefault: number;
  override: number | null;
  effective: number;
  min: number;
  max: number;
};

export type ComputedOutboxClaimConcurrency = {
  processDefault: { perBase: number; perSeedTable: number };
  override: { perBase: number | null; perSeedTable: number | null };
  effective: { perBase: number; perSeedTable: number };
  min: number;
  max: number;
};

export type ComputedOutboxOverview = {
  status: ComputedOutboxHealthStatus;
  reasons: ComputedOutboxHealthReason[];
  sampledAt: string;
  config: {
    provider: 'bullmq';
    producerEnabled: boolean;
    consumerEnabled: boolean;
    monitorIntervalMs: number;
  };
  queue: {
    configured: boolean;
    reachable: boolean;
    isPaused?: boolean;
    workers: number | null;
    workerConcurrency?: {
      processDefault: number;
      override: number | null;
      min: number;
      max: number;
    };
    claimConcurrency?: {
      processDefault: { perBase: number; perSeedTable: number };
      override: { perBase: number | null; perSeedTable: number | null };
      min: number;
      max: number;
    };
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    paused: number;
    prioritized: number;
    completed: number;
    completedRetentionLimit: number;
    failedRetentionLimit: number;
    recentCompleted: Array<{
      taskId: string;
      baseId: string;
      baseName?: string;
      spaceId?: string;
      spaceName?: string;
      cause: ComputedOutboxQueueJobCause;
      finishedAt: string;
      processingDurationMs?: number;
      attemptsMade: number;
    }>;
    recentFailed: Array<{
      taskId: string;
      baseId: string;
      baseName?: string;
      spaceId?: string;
      spaceName?: string;
      cause?: ComputedOutboxQueueJobCause;
      failedAt: string;
      failedReason: string | null;
      attemptsMade: number;
      ledgerState?: ComputedOutboxLedgerState;
    }>;
    error?: string;
  };
  outbox: {
    duePending: number;
    scheduledPending: number;
    pausedPending?: number;
    activeProcessing: number;
    staleProcessing: number;
    dead: number;
    anomalyGroups?: number;
    oldestDueAgeMs: number;
    oldestPausedAgeMs?: number;
    activePauseScopeCount?: number;
    targetCount: number;
    unavailableTargetCount: number;
    storage: Array<{
      duePending: number;
      scheduledPending: number;
      pausedPending?: number;
      activeProcessing: number;
      staleProcessing: number;
      dead: number;
      anomalyGroups?: number;
      oldestDueAgeMs: number;
      oldestPausedAgeMs?: number;
      activePauseScopeCount?: number;
      storage: ComputedOutboxStorageKind;
      targetCount: number;
      unavailableTargetCount: number;
    }>;
    error?: string;
  };
  pauses?: {
    activeScopeCount: number;
    pausedPending: number;
    oldestPausedAgeMs: number;
  };
  dataDbHealth?: {
    unhealthyByodbConnections: number;
  };
  activity: {
    scope: 'process';
    lastPublishAt?: string;
    lastPublishResult?: 'accepted' | 'error' | 'timeout';
    lastPublishCause?: string;
    lastConsumeAt?: string;
    lastConsumeOutcome?: 'processed' | 'noop' | 'deferred' | 'parked' | 'error' | 'invalid';
    lastDeliveryLagMs?: number;
    lastExecutionDurationMs?: number;
  };
};

export type RecoverComputedOutboxAnomalyResult = {
  taskId: string;
  kind: ComputedOutboxAnomalyKind;
  recovered: true;
  delivery: ComputedOutboxWakeupDeliveryResult;
};

export type RecoverComputedOutboxAnomalyBatchResult = {
  targetId: string;
  recovered: number;
  inserted: number;
  alreadyPending: number;
  deliveryAccepted: number;
  deliveryDeferred: number;
};

export type DiscardComputedOutboxAnomalyBatchResult = {
  targetId: string;
  discarded: number;
};

export type ResumeComputedOutboxScopeResult = {
  targetId: string;
  scopeType: ComputedOutboxPauseScopeType;
  scopeId: string;
  resumed: boolean;
};
