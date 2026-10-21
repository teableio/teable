import type {
  ComputedOutboxQueueJob,
  ComputedOutboxQueueJobCause,
  ComputedOutboxQueueJobList,
  ComputedOutboxQueueJobOutcome,
  ComputedOutboxQueueJobScan,
  ComputedOutboxQueueJobSort,
  ComputedOutboxQueueJobView,
} from './types';

const ALL_QUEUE_JOB_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'paused',
  'prioritized',
  'completed',
] as const;

export const computedOutboxQueueJobStatesFallback = ALL_QUEUE_JOB_STATES;

const queueJobSortKey = (job: ComputedOutboxQueueJob) =>
  job.finishedAt ?? job.startedAt ?? job.scheduledFor ?? job.createdAt;

const taskRepresentativeRank = (job: ComputedOutboxQueueJob): number => {
  if (job.state === 'active') return 4;
  if (job.state === 'waiting' || job.state === 'delayed' || job.state === 'prioritized') return 3;
  if (job.state === 'failed') return 2;
  if (job.state === 'completed') return 1;
  return 0;
};

const isSettledFailure = (job: ComputedOutboxQueueJob) =>
  job.state === 'failed' && job.ledgerState === 'settled';

const groupJobsByTask = (jobs: ComputedOutboxQueueJob[]): ComputedOutboxQueueJob[] => {
  const byTask = new Map<string, ComputedOutboxQueueJob[]>();
  for (const job of jobs) {
    const group = byTask.get(job.taskId);
    if (group) group.push(job);
    else byTask.set(job.taskId, [job]);
  }
  return [...byTask.values()].map((deliveries) => {
    const ranked = [...deliveries].sort(
      (left, right) =>
        taskRepresentativeRank(right) - taskRepresentativeRank(left) ||
        queueJobSortKey(right).localeCompare(queueJobSortKey(left))
    );
    const representative = ranked[0]!;
    return deliveries.length === 1
      ? representative
      : { ...representative, deliveryCount: deliveries.length };
  });
};

const buildQueueJobFacets = (
  jobs: ReadonlyArray<ComputedOutboxQueueJob>
): ComputedOutboxQueueJobList['facets'] => {
  const spaces = new Map<string, { id: string; name?: string; count: number }>();
  const bases = new Map<string, { id: string; name?: string; spaceId?: string; count: number }>();
  const causes = new Map<string, { cause: ComputedOutboxQueueJobCause; count: number }>();
  const outcomes = new Map<string, { outcome: ComputedOutboxQueueJobOutcome; count: number }>();
  for (const job of jobs) {
    if (job.spaceId) {
      const space = spaces.get(job.spaceId) ?? { id: job.spaceId, name: job.spaceName, count: 0 };
      space.count += 1;
      spaces.set(job.spaceId, space);
    }
    const base = bases.get(job.baseId) ?? {
      id: job.baseId,
      name: job.baseName,
      spaceId: job.spaceId,
      count: 0,
    };
    base.count += 1;
    bases.set(job.baseId, base);
    if (job.cause) {
      const cause = causes.get(job.cause) ?? { cause: job.cause, count: 0 };
      cause.count += 1;
      causes.set(job.cause, cause);
    }
    if (job.outcome) {
      const outcome = outcomes.get(job.outcome) ?? { outcome: job.outcome, count: 0 };
      outcome.count += 1;
      outcomes.set(job.outcome, outcome);
    }
  }
  const byCountDesc = (left: { count: number }, right: { count: number }) =>
    right.count - left.count;
  return {
    spaces: [...spaces.values()].sort(byCountDesc),
    bases: [...bases.values()].sort(byCountDesc),
    causes: [...causes.values()].sort(byCountDesc),
    outcomes: [...outcomes.values()].sort(byCountDesc),
  };
};

export type ProjectComputedOutboxQueueJobsInput = {
  jobs: ReadonlyArray<ComputedOutboxQueueJob>;
  scan: ReadonlyArray<ComputedOutboxQueueJobScan>;
  error?: string;
  states: ReadonlyArray<ComputedOutboxQueueJob['state']>;
  spaceIds: ReadonlyArray<string>;
  baseIds: ReadonlyArray<string>;
  causes: ReadonlyArray<ComputedOutboxQueueJobCause>;
  outcomes: ReadonlyArray<ComputedOutboxQueueJobOutcome>;
  q?: string;
  minDurationMs?: number;
  view: ComputedOutboxQueueJobView;
  includeSettled?: boolean;
  sort: ComputedOutboxQueueJobSort;
  limit: number;
  offset: number;
  sampledAt?: string;
};

export const projectComputedOutboxQueueJobs = (
  input: ProjectComputedOutboxQueueJobsInput
): ComputedOutboxQueueJobList => {
  const rows = input.view === 'tasks' ? groupJobsByTask([...input.jobs]) : [...input.jobs];
  const jobs = input.includeSettled ? rows : rows.filter((job) => !isSettledFailure(job));
  const hiddenSettled = rows.length - jobs.length;

  const spaceIds = new Set(input.spaceIds);
  const baseIds = new Set(input.baseIds);
  const causes = new Set(input.causes);
  const outcomes = new Set(input.outcomes);
  const q = input.q?.toLocaleLowerCase();
  const filtered = jobs.filter((job) => {
    if (spaceIds.size && (!job.spaceId || !spaceIds.has(job.spaceId))) return false;
    if (baseIds.size && !baseIds.has(job.baseId)) return false;
    if (causes.size && (!job.cause || !causes.has(job.cause))) return false;
    if (outcomes.size && (!job.outcome || !outcomes.has(job.outcome))) return false;
    if (
      input.minDurationMs != null &&
      (job.processingDurationMs == null || job.processingDurationMs < input.minDurationMs)
    ) {
      return false;
    }
    if (!q) return true;
    return [job.taskId, job.baseId, job.baseName, job.spaceId, job.spaceName, job.failedReason]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(q);
  });
  filtered.sort((left, right) =>
    input.sort === 'duration'
      ? (right.processingDurationMs ?? -1) - (left.processingDurationMs ?? -1)
      : queueJobSortKey(right).localeCompare(queueJobSortKey(left))
  );

  return {
    sampledAt: input.sampledAt ?? new Date().toISOString(),
    total: filtered.length,
    limit: input.limit,
    offset: input.offset,
    jobs: filtered.slice(input.offset, input.offset + input.limit),
    scan: [...input.scan],
    facets: buildQueueJobFacets(jobs),
    ...(hiddenSettled > 0 ? { hiddenSettled } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
};
