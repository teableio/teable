import {
  scheduleExecutionContextBackgroundTask,
  type ExecutionContextBackgroundTask,
  type ExecutionContextBackgroundTaskScheduler,
  type IExecutionContext,
} from '../ExecutionContext';

/** Tracks scheduled and active projection tasks without making commands await them. */
export class BackgroundTaskTracker {
  private pending = 0;
  private readonly schedulers = new WeakSet<ExecutionContextBackgroundTaskScheduler>();
  private readonly waiters = new Set<() => void>();

  context(context: IExecutionContext): IExecutionContext {
    if (context.scheduleBackgroundTask && this.schedulers.has(context.scheduleBackgroundTask)) {
      return context;
    }
    const schedule: ExecutionContextBackgroundTaskScheduler = (
      task: ExecutionContextBackgroundTask
    ) => {
      this.pending += 1;
      let started = false;
      const run = async () => {
        started = true;
        try {
          await task();
        } finally {
          this.complete();
        }
      };
      try {
        scheduleExecutionContextBackgroundTask(context, run);
      } catch (error) {
        if (!started) this.complete();
        throw error;
      }
    };
    this.schedulers.add(schedule);
    return { ...context, scheduleBackgroundTask: schedule };
  }

  pendingCount(): number {
    return this.pending;
  }

  async settled(): Promise<void> {
    while (this.pending > 0) {
      await new Promise<void>((resolve) => this.waiters.add(resolve));
    }
  }

  private complete(): void {
    this.pending -= 1;
    if (this.pending !== 0) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
}
