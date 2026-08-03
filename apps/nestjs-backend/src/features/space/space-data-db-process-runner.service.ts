/* eslint-disable @typescript-eslint/naming-convention */
import type { SpawnOptions } from 'child_process';
import { spawn as nodeSpawn } from 'child_process';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ISpaceDataDbProcessPipelinePlan,
  ISpaceDataDbProcessPlan,
} from './space-data-db-copy-plan';

export const SPACE_DATA_DB_PROCESS_SPAWN = Symbol('SPACE_DATA_DB_PROCESS_SPAWN');

type IProcessLike = {
  pid?: number;
  stdin?: NodeJS.WritableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  stdout?: NodeJS.ReadableStream | null;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | 0): boolean;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
};

export type ISpaceDataDbProcessSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions
) => IProcessLike;

export type ISpaceDataDbProcessRunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stderrLimit?: number;
  stdoutLimit?: number;
  cancelPollMs?: number;
  exitFallbackMs?: number;
  pollTimeoutMs?: number;
  pollFailureTimeoutMs?: number;
  shouldCancel?: () => boolean | Promise<boolean>;
  pollMs?: number;
  onPoll?: () => void | Promise<void>;
};

export type ISpaceDataDbProcessRunResult = {
  command: string;
  args: string[];
  exitCode: number;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

type ISpaceDataDbProcessPartialResult = Omit<ISpaceDataDbProcessRunResult, 'exitCode'> & {
  exitCode: number | null;
};

export type ISpaceDataDbProcessPipelineResult = {
  source: ISpaceDataDbProcessRunResult;
  target: ISpaceDataDbProcessRunResult;
};

const defaultCancelPollMs = 1_000;
const defaultExitFallbackMs = 5_000;
const defaultStderrLimit = 16 * 1024;

const runProgressPoll = async (
  options: ISpaceDataDbProcessRunOptions,
  isSettled: () => boolean
) => {
  if (!options.onPoll || isSettled()) {
    return;
  }
  await options.onPoll();
};

const createProgressPollRunner = (
  options: ISpaceDataDbProcessRunOptions,
  isSettled: () => boolean,
  onTimeout: (error: Error) => void
) => {
  let inFlight = false;
  let timeout: NodeJS.Timeout | undefined;
  let firstFailureAtMs: number | null = null;

  const clear = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };

  const run = () => {
    if (!options.onPoll || isSettled() || inFlight) {
      return;
    }

    inFlight = true;
    let timedOut = false;
    const pollTimeoutMs =
      options.pollTimeoutMs && options.pollTimeoutMs > 0
        ? Math.max(1, Math.floor(options.pollTimeoutMs))
        : undefined;
    const pollFailureTimeoutMs =
      options.pollFailureTimeoutMs && options.pollFailureTimeoutMs > 0
        ? Math.max(1, Math.floor(options.pollFailureTimeoutMs))
        : undefined;

    if (pollTimeoutMs) {
      timeout = setTimeout(() => {
        if (timedOut || isSettled()) {
          return;
        }
        timedOut = true;
        inFlight = false;
        timeout = undefined;
        onTimeout(new Error(`Process progress poll timed out after ${pollTimeoutMs}ms`));
      }, pollTimeoutMs);
    }

    void runProgressPoll(options, isSettled)
      .then(() => {
        firstFailureAtMs = null;
      })
      .catch((error) => {
        if (timedOut || isSettled()) {
          return;
        }
        if (!pollFailureTimeoutMs) {
          return;
        }
        const now = Date.now();
        firstFailureAtMs ??= now;
        if (now - firstFailureAtMs < pollFailureTimeoutMs) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        timedOut = true;
        inFlight = false;
        clear();
        onTimeout(
          new Error(`Process progress poll failed for ${pollFailureTimeoutMs}ms: ${message}`)
        );
      })
      .finally(() => {
        if (timedOut) {
          return;
        }
        inFlight = false;
        clear();
      });
  };

  return { run, clear };
};

const redactSecrets = (value: string) =>
  value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+(@)/gi, '$1***$2')
    .replace(/(invalid percent-encoded token:\s*["'])[^"']*(["'])/gi, '$1***$2')
    .replace(/(password\s+')[^']*(')/gi, '$1***$2')
    .replace(/(password=)[^'\s,)]+/gi, '$1***');

const appendBounded = (current: string, chunk: unknown, limit: number) => {
  const next =
    current + redactSecrets(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  if (next.length <= limit) {
    return next;
  }
  return next.slice(next.length - limit);
};

const redactArgs = (args: string[]) => args.map((arg) => redactSecrets(arg));

export class SpaceDataDbProcessError extends Error {
  constructor(
    message: string,
    readonly result: Omit<ISpaceDataDbProcessRunResult, 'exitCode'> & {
      exitCode: number | null;
    }
  ) {
    super(message);
  }
}

export class SpaceDataDbProcessPipelineError extends Error {
  constructor(
    message: string,
    readonly result: {
      label?: string;
      source: ISpaceDataDbProcessPartialResult;
      target: ISpaceDataDbProcessPartialResult;
    }
  ) {
    super(message);
  }
}

export class SpaceDataDbProcessCanceledError extends SpaceDataDbProcessError {
  constructor(result: SpaceDataDbProcessError['result']) {
    super('Process canceled', result);
  }
}

export class SpaceDataDbProcessPipelineCanceledError extends SpaceDataDbProcessPipelineError {
  constructor(result: SpaceDataDbProcessPipelineError['result']) {
    super('Process pipeline canceled', result);
  }
}

type IProcessState = {
  command: string;
  args: string[];
  stderr: string;
  stdout: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  startedAtMs: number;
  completedAt: string | null;
  durationMs: number | null;
};

type IReadableState = NodeJS.ReadableStream & {
  closed?: boolean;
  destroyed?: boolean;
  readableEnded?: boolean;
};

type IWritableState = NodeJS.WritableStream & {
  closed?: boolean;
  destroyed?: boolean;
  writableEnded?: boolean;
  writableFinished?: boolean;
};

const nowTiming = () => {
  const now = new Date();
  return {
    iso: now.toISOString(),
    ms: now.getTime(),
  };
};

const durationSince = (startedAtMs: number, completedAtMs: number) =>
  Math.max(0, completedAtMs - startedAtMs);

const initProcessState = (plan: ISpaceDataDbProcessPlan): IProcessState => {
  const startedAt = nowTiming();
  return {
    command: plan.command,
    args: redactArgs(plan.args),
    stderr: '',
    stdout: '',
    exitCode: null,
    signal: null,
    startedAt: startedAt.iso,
    startedAtMs: startedAt.ms,
    completedAt: null,
    durationMs: null,
  };
};

const completeProcessState = (state: IProcessState) => {
  if (state.completedAt) {
    return;
  }
  const completedAt = nowTiming();
  state.completedAt = completedAt.iso;
  state.durationMs = durationSince(state.startedAtMs, completedAt.ms);
};

const toPartialResult = (state: IProcessState): ISpaceDataDbProcessPartialResult => ({
  command: state.command,
  args: state.args,
  exitCode: state.exitCode,
  signal: state.signal,
  stderr: state.stderr,
  stdout: state.stdout,
  startedAt: state.startedAt,
  completedAt: state.completedAt ?? new Date(state.startedAtMs).toISOString(),
  durationMs: state.durationMs ?? 0,
});

const toRunResult = (state: IProcessState): ISpaceDataDbProcessRunResult => ({
  command: state.command,
  args: state.args,
  exitCode: state.exitCode ?? 0,
  signal: state.signal,
  stderr: state.stderr,
  stdout: state.stdout,
  startedAt: state.startedAt,
  completedAt: state.completedAt ?? new Date(state.startedAtMs).toISOString(),
  durationMs: state.durationMs ?? 0,
});

const isProcessGoneWithoutExitStatus = (child: IProcessLike, state: IProcessState) => {
  if (state.exitCode !== null || state.signal !== null || child.pid == null) {
    return false;
  }
  try {
    return child.kill(0) === false;
  } catch {
    return true;
  }
};

@Injectable()
export class SpaceDataDbProcessRunnerService {
  constructor(
    @Optional()
    @Inject(SPACE_DATA_DB_PROCESS_SPAWN)
    private readonly spawnProcess: ISpaceDataDbProcessSpawn = nodeSpawn as ISpaceDataDbProcessSpawn
  ) {}

  async run(
    plan: ISpaceDataDbProcessPlan,
    options: ISpaceDataDbProcessRunOptions = {}
  ): Promise<ISpaceDataDbProcessRunResult> {
    const stderrLimit = options.stderrLimit ?? defaultStderrLimit;
    const stdoutLimit = options.stdoutLimit ?? stderrLimit;
    const redactedArgs = redactArgs(plan.args);
    const startedAt = nowTiming();
    const child = this.spawnProcess(plan.command, plan.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    let cancelTimer: NodeJS.Timeout | undefined;
    let pollTimer: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let exitFallbackTimer: NodeJS.Timeout | undefined;
    let stdioFallbackTimer: NodeJS.Timeout | undefined;
    let progressPollCleanup: (() => void) | undefined;
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let exited = false;
    let closed = false;
    let stdoutClosed = !child.stdout;
    let stderrClosed = !child.stderr;

    child.stderr?.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk, stderrLimit);
    });
    child.stdout?.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk, stdoutLimit);
    });

    const buildResult = <TExitCode extends number | null>(
      exitCode: TExitCode,
      signal: NodeJS.Signals | null
    ) => {
      const completedAt = nowTiming();
      return {
        command: plan.command,
        args: redactedArgs,
        exitCode,
        signal,
        stderr,
        stdout,
        startedAt: startedAt.iso,
        completedAt: completedAt.iso,
        durationMs: durationSince(startedAt.ms, completedAt.ms),
      };
    };

    return await new Promise<ISpaceDataDbProcessRunResult>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (cancelTimer) {
          clearInterval(cancelTimer);
        }
        if (pollTimer) {
          clearInterval(pollTimer);
        }
        if (exitFallbackTimer) {
          clearTimeout(exitFallbackTimer);
        }
        if (stdioFallbackTimer) {
          clearTimeout(stdioFallbackTimer);
        }
        progressPollCleanup?.();
        fn();
      };

      const cancel = () => {
        child.kill('SIGTERM');
        settle(() => {
          reject(new SpaceDataDbProcessCanceledError(buildResult(null, 'SIGTERM')));
        });
      };
      const checkCancel = async () => {
        if (!options.shouldCancel || settled) {
          return;
        }
        if (await options.shouldCancel()) {
          cancel();
        }
      };
      if (options.shouldCancel) {
        cancelTimer = setInterval(
          () => {
            void checkCancel().catch(() => undefined);
          },
          Math.max(1, options.cancelPollMs ?? defaultCancelPollMs)
        );
        void checkCancel().catch(() => undefined);
      }
      if (options.onPoll) {
        const progressPoll = createProgressPollRunner(
          options,
          () => settled,
          (error) => {
            child.kill('SIGTERM');
            settle(() => {
              reject(
                new SpaceDataDbProcessError(
                  `${error.message}: ${plan.command} ${redactedArgs.join(' ')}`,
                  buildResult(null, 'SIGTERM')
                )
              );
            });
          }
        );
        progressPollCleanup = progressPoll.clear;
        pollTimer = setInterval(
          progressPoll.run,
          Math.max(1, options.pollMs ?? defaultCancelPollMs)
        );
        progressPoll.run();
      }

      if (options.timeoutMs && options.timeoutMs > 0) {
        timeout = setTimeout(() => {
          child.kill('SIGTERM');
          settle(() => {
            reject(
              new SpaceDataDbProcessError(
                `Process timed out: ${plan.command} ${redactedArgs.join(' ')}`,
                buildResult(null, 'SIGTERM')
              )
            );
          });
        }, options.timeoutMs);
      }

      child.on('error', (error) => {
        settle(() => {
          reject(
            new SpaceDataDbProcessError(
              `Process failed to start: ${plan.command} ${redactedArgs.join(' ')}`,
              {
                ...buildResult(null, null),
                exitCode: null,
                signal: null,
                stderr: stderr || redactSecrets(error.message),
              }
            )
          );
        });
      });

      const settleFromExitStatus = () => {
        const result = buildResult(exitCode ?? 0, signal);
        if (exitCode === 0 || (exitCode === null && !stderr)) {
          settle(() => resolve(result));
          return;
        }
        settle(() => {
          reject(
            new SpaceDataDbProcessError(
              `Process exited with code ${exitCode}: ${plan.command} ${redactedArgs.join(' ')}`,
              result
            )
          );
        });
      };
      const scheduleExitFallback = () => {
        if (settled || exitFallbackTimer || !exited || closed) {
          return;
        }
        exitFallbackTimer = setTimeout(
          () => {
            exitFallbackTimer = undefined;
            if (settled || closed) {
              return;
            }
            settleFromExitStatus();
          },
          Math.max(1, options.exitFallbackMs ?? defaultExitFallbackMs)
        );
      };
      const scheduleStdioFallback = () => {
        if (settled || stdioFallbackTimer || !stdoutClosed || !stderrClosed || closed) {
          return;
        }
        stdioFallbackTimer = setTimeout(
          () => {
            stdioFallbackTimer = undefined;
            if (settled || closed) {
              return;
            }
            settleFromExitStatus();
          },
          Math.max(1, options.exitFallbackMs ?? defaultExitFallbackMs)
        );
      };
      const markStdoutClosed = () => {
        stdoutClosed = true;
        scheduleStdioFallback();
      };
      const markStderrClosed = () => {
        stderrClosed = true;
        scheduleStdioFallback();
      };
      child.stdout?.on('end', markStdoutClosed);
      child.stdout?.on('close', markStdoutClosed);
      child.stderr?.on('end', markStderrClosed);
      child.stderr?.on('close', markStderrClosed);
      child.on('exit', (childExitCode, childSignal) => {
        exited = true;
        exitCode = childExitCode;
        signal = childSignal;
        scheduleExitFallback();
      });
      child.on('close', (exitCode, signal) => {
        closed = true;
        exited = true;
        const result = buildResult(exitCode ?? 0, signal);
        if (exitCode === 0) {
          settle(() => resolve(result));
          return;
        }
        settle(() => {
          reject(
            new SpaceDataDbProcessError(
              `Process exited with code ${exitCode}: ${plan.command} ${redactedArgs.join(' ')}`,
              result
            )
          );
        });
      });
    });
  }

  async runPipeline(
    plan: ISpaceDataDbProcessPipelinePlan,
    options: ISpaceDataDbProcessRunOptions = {}
  ): Promise<ISpaceDataDbProcessPipelineResult> {
    const stderrLimit = options.stderrLimit ?? defaultStderrLimit;
    const stdoutLimit = options.stdoutLimit ?? stderrLimit;
    const sourceState = initProcessState(plan.source);
    const targetState = initProcessState(plan.target);
    const sourceChild = this.spawnProcess(plan.source.command, plan.source.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const targetChild = this.spawnProcess(plan.target.command, plan.target.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    sourceChild.stderr?.on('data', (chunk) => {
      sourceState.stderr = appendBounded(sourceState.stderr, chunk, stderrLimit);
    });
    targetChild.stderr?.on('data', (chunk) => {
      targetState.stderr = appendBounded(targetState.stderr, chunk, stderrLimit);
    });
    targetChild.stdout?.on('data', (chunk) => {
      targetState.stdout = appendBounded(targetState.stdout, chunk, stdoutLimit);
    });

    return await new Promise<ISpaceDataDbProcessPipelineResult>((resolve, reject) => {
      let settled = false;
      let cancelTimer: NodeJS.Timeout | undefined;
      let pollTimer: NodeJS.Timeout | undefined;
      let timeout: NodeJS.Timeout | undefined;
      let exitFallbackTimer: NodeJS.Timeout | undefined;
      let stdioFallbackTimer: NodeJS.Timeout | undefined;
      let successfulTargetFallbackTimer: NodeJS.Timeout | undefined;
      let sourceInputFallbackTimer: NodeJS.Timeout | undefined;
      let targetCopyFailureTimer: NodeJS.Timeout | undefined;
      let targetCopyFailurePending = false;
      let progressPollCleanup: (() => void) | undefined;
      const timers: { processStatePollTimer?: NodeJS.Timeout } = {};
      let sourceClosed = false;
      let targetClosed = false;
      let sourceExited = false;
      let targetExited = false;
      let sourceStdoutClosed = false;
      let sourceStderrClosed = !sourceChild.stderr;
      let targetStdinClosed = false;
      let targetStdoutClosed = !targetChild.stdout;
      let targetStderrClosed = !targetChild.stderr;
      const clearTimers = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (cancelTimer) {
          clearInterval(cancelTimer);
        }
        if (pollTimer) {
          clearInterval(pollTimer);
        }
        if (exitFallbackTimer) {
          clearTimeout(exitFallbackTimer);
        }
        if (stdioFallbackTimer) {
          clearTimeout(stdioFallbackTimer);
        }
        if (successfulTargetFallbackTimer) {
          clearTimeout(successfulTargetFallbackTimer);
        }
        if (sourceInputFallbackTimer) {
          clearTimeout(sourceInputFallbackTimer);
        }
        if (targetCopyFailureTimer) {
          clearTimeout(targetCopyFailureTimer);
        }
        if (timers.processStatePollTimer) {
          clearInterval(timers.processStatePollTimer);
        }
        progressPollCleanup?.();
      };
      const rejectPipeline = (message: string, killSource: boolean, killTarget: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        if (killSource) {
          sourceState.signal = sourceState.signal ?? 'SIGTERM';
          sourceChild.kill('SIGTERM');
        }
        if (killTarget) {
          targetState.signal = targetState.signal ?? 'SIGTERM';
          targetChild.kill('SIGTERM');
        }
        completeProcessState(sourceState);
        completeProcessState(targetState);
        reject(
          new SpaceDataDbProcessPipelineError(message, {
            label: plan.label,
            source: toPartialResult(sourceState),
            target: toPartialResult(targetState),
          })
        );
      };
      const resolveIfComplete = () => {
        if (settled || sourceState.exitCode !== 0 || targetState.exitCode !== 0) {
          return;
        }
        settled = true;
        clearTimers();
        completeProcessState(sourceState);
        completeProcessState(targetState);
        resolve({
          source: toRunResult(sourceState),
          target: toRunResult(targetState),
        });
      };

      if (!sourceChild.stdout || !targetChild.stdin) {
        rejectPipeline(
          `Process pipeline could not be opened: ${plan.source.command} -> ${plan.target.command}`,
          true,
          true
        );
        return;
      }

      const cancelPipeline = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        sourceState.signal = sourceState.signal ?? 'SIGTERM';
        targetState.signal = targetState.signal ?? 'SIGTERM';
        sourceChild.kill('SIGTERM');
        targetChild.kill('SIGTERM');
        completeProcessState(sourceState);
        completeProcessState(targetState);
        reject(
          new SpaceDataDbProcessPipelineCanceledError({
            label: plan.label,
            source: toPartialResult(sourceState),
            target: toPartialResult(targetState),
          })
        );
      };
      const checkCancel = async () => {
        if (!options.shouldCancel || settled) {
          return;
        }
        if (await options.shouldCancel()) {
          cancelPipeline();
        }
      };
      if (options.shouldCancel) {
        cancelTimer = setInterval(
          () => {
            void checkCancel().catch(() => undefined);
          },
          Math.max(1, options.cancelPollMs ?? defaultCancelPollMs)
        );
        void checkCancel().catch(() => undefined);
      }
      if (options.onPoll) {
        const progressPoll = createProgressPollRunner(
          options,
          () => settled,
          (error) => {
            rejectPipeline(
              `${error.message}: ${plan.source.command} -> ${plan.target.command}`,
              true,
              true
            );
          }
        );
        progressPollCleanup = progressPoll.clear;
        pollTimer = setInterval(
          progressPoll.run,
          Math.max(1, options.pollMs ?? defaultCancelPollMs)
        );
        progressPoll.run();
      }

      if (options.timeoutMs && options.timeoutMs > 0) {
        timeout = setTimeout(() => {
          sourceState.signal = sourceState.signal ?? 'SIGTERM';
          targetState.signal = targetState.signal ?? 'SIGTERM';
          rejectPipeline(
            `Process pipeline timed out: ${plan.source.command} -> ${plan.target.command}`,
            true,
            true
          );
        }, options.timeoutMs);
      }

      const scheduleExitFallback = () => {
        if (
          settled ||
          exitFallbackTimer ||
          !sourceExited ||
          !targetExited ||
          (sourceClosed && targetClosed)
        ) {
          return;
        }

        exitFallbackTimer = setTimeout(
          () => {
            exitFallbackTimer = undefined;
            if (settled || (sourceClosed && targetClosed)) {
              return;
            }
            if (sourceState.exitCode === 0 && targetState.exitCode === 0) {
              resolveIfComplete();
              return;
            }
            rejectPipeline(
              `Process pipeline exited before stdio closed: ${plan.source.command} -> ${plan.target.command}`,
              false,
              false
            );
          },
          Math.max(1, options.exitFallbackMs ?? defaultExitFallbackMs)
        );
      };
      const isSourceOutputSettled = () =>
        (sourceStdoutClosed && sourceStderrClosed) ||
        (sourceState.exitCode === 0 && !sourceState.stderr);
      const scheduleStdioFallback = () => {
        if (
          settled ||
          stdioFallbackTimer ||
          !isSourceOutputSettled() ||
          !targetStdinClosed ||
          !targetStdoutClosed ||
          !targetStderrClosed ||
          (sourceClosed && targetClosed)
        ) {
          return;
        }

        stdioFallbackTimer = setTimeout(
          () => {
            stdioFallbackTimer = undefined;
            if (settled || (sourceClosed && targetClosed)) {
              return;
            }
            if (
              !isSourceOutputSettled() ||
              !targetStdinClosed ||
              !targetStdoutClosed ||
              !targetStderrClosed
            ) {
              return;
            }
            if (
              (sourceState.exitCode !== null && sourceState.exitCode !== 0) ||
              (targetState.exitCode !== null && targetState.exitCode !== 0)
            ) {
              rejectPipeline(
                `Process pipeline stdio closed after a non-zero exit: ${plan.source.command} -> ${plan.target.command}`,
                false,
                false
              );
              return;
            }
            if (
              (sourceState.exitCode === null || targetState.exitCode === null) &&
              (sourceState.stderr || targetState.stderr)
            ) {
              rejectPipeline(
                `Process pipeline stdio closed without exit status and stderr output: ${plan.source.command} -> ${plan.target.command}`,
                false,
                false
              );
              return;
            }
            settled = true;
            clearTimers();
            completeProcessState(sourceState);
            completeProcessState(targetState);
            resolve({
              source: toRunResult(sourceState),
              target: toRunResult(targetState),
            });
          },
          Math.max(1, options.exitFallbackMs ?? defaultExitFallbackMs)
        );
      };
      const scheduleSuccessfulTargetFallback = () => {
        if (
          settled ||
          successfulTargetFallbackTimer ||
          targetState.exitCode !== 0 ||
          sourceState.exitCode !== null ||
          !sourceStdoutClosed ||
          !sourceStderrClosed ||
          sourceState.stderr
        ) {
          return;
        }

        successfulTargetFallbackTimer = setTimeout(
          () => {
            successfulTargetFallbackTimer = undefined;
            if (
              settled ||
              targetState.exitCode !== 0 ||
              sourceState.exitCode !== null ||
              !sourceStdoutClosed ||
              !sourceStderrClosed ||
              sourceState.stderr
            ) {
              return;
            }
            settled = true;
            clearTimers();
            completeProcessState(sourceState);
            completeProcessState(targetState);
            resolve({
              source: toRunResult(sourceState),
              target: toRunResult(targetState),
            });
          },
          Math.max(1, options.exitFallbackMs ?? defaultExitFallbackMs)
        );
      };
      const endTargetStdin = () => {
        if (targetStdinClosed) {
          return;
        }
        const stdin = targetChild.stdin as typeof targetChild.stdin & {
          destroyed?: boolean;
          writableEnded?: boolean;
        };
        if (stdin.destroyed || stdin.writableEnded) {
          markTargetStdinClosed();
          return;
        }
        stdin.end();
      };
      const scheduleSourceInputFallback = () => {
        if (
          settled ||
          sourceInputFallbackTimer ||
          sourceStdoutClosed ||
          targetStdinClosed ||
          sourceState.exitCode !== 0
        ) {
          return;
        }
        sourceInputFallbackTimer = setTimeout(
          () => {
            sourceInputFallbackTimer = undefined;
            if (settled || sourceStdoutClosed || targetStdinClosed || sourceState.exitCode !== 0) {
              return;
            }
            endTargetStdin();
          },
          Math.max(1, options.exitFallbackMs ?? defaultExitFallbackMs)
        );
      };
      const scheduleTargetCopyFailure = (message: string) => {
        if (settled || targetCopyFailureTimer) {
          return;
        }
        targetCopyFailurePending = true;
        sourceState.signal = sourceState.signal ?? 'SIGTERM';
        sourceChild.kill('SIGTERM');
        targetCopyFailureTimer = setTimeout(
          () => {
            targetCopyFailureTimer = undefined;
            if (settled) {
              return;
            }
            rejectPipeline(message, false, false);
          },
          Math.max(1, Math.min(options.exitFallbackMs ?? defaultExitFallbackMs, 1000))
        );
      };
      const syncProcessExitStatus = () => {
        const syncOne = (child: IProcessLike, state: IProcessState, setExited: () => void) => {
          if (state.exitCode !== null || state.signal !== null) {
            return false;
          }
          const exitCode = child.exitCode;
          const signalCode = child.signalCode;
          if (exitCode == null && signalCode == null) {
            return false;
          }
          state.exitCode = exitCode ?? null;
          state.signal = signalCode ?? null;
          completeProcessState(state);
          setExited();
          return true;
        };
        const sourceChanged = syncOne(sourceChild, sourceState, () => {
          sourceExited = true;
        });
        const targetChanged = syncOne(targetChild, targetState, () => {
          targetExited = true;
        });
        if (!sourceChanged && !targetChanged) {
          return;
        }
        scheduleSourceInputFallback();
        scheduleExitFallback();
        scheduleStdioFallback();
        scheduleSuccessfulTargetFallback();
      };
      const rejectMissingExitedProcesses = () => {
        if (settled) {
          return;
        }
        const sourceMissing = isProcessGoneWithoutExitStatus(sourceChild, sourceState);
        const targetMissing = isProcessGoneWithoutExitStatus(targetChild, targetState);
        if (!sourceMissing && !targetMissing) {
          return;
        }
        rejectPipeline(
          `Process pipeline exited without status: ${plan.source.command} -> ${plan.target.command}`,
          !sourceMissing,
          !targetMissing
        );
      };
      const syncStdioState = () => {
        const sourceStdout = sourceChild.stdout as IReadableState;
        const sourceStderr = sourceChild.stderr as IReadableState | null | undefined;
        const targetStdin = targetChild.stdin as IWritableState;
        const targetStdout = targetChild.stdout as IReadableState | null | undefined;
        const targetStderr = targetChild.stderr as IReadableState | null | undefined;

        if (sourceStdout.closed || sourceStdout.destroyed || sourceStdout.readableEnded) {
          markSourceStdoutClosed();
        }
        if (
          !sourceStderr ||
          sourceStderr.closed ||
          sourceStderr.destroyed ||
          sourceStderr.readableEnded
        ) {
          markSourceStderrClosed();
        }
        if (
          targetStdin.closed ||
          targetStdin.destroyed ||
          targetStdin.writableEnded ||
          targetStdin.writableFinished
        ) {
          markTargetStdinClosed();
        }
        if (
          !targetStdout ||
          targetStdout.closed ||
          targetStdout.destroyed ||
          targetStdout.readableEnded
        ) {
          markTargetStdoutClosed();
        }
        if (
          !targetStderr ||
          targetStderr.closed ||
          targetStderr.destroyed ||
          targetStderr.readableEnded
        ) {
          markTargetStderrClosed();
        }
      };
      const markSourceStdoutClosed = () => {
        sourceStdoutClosed = true;
        endTargetStdin();
        scheduleStdioFallback();
        scheduleSuccessfulTargetFallback();
      };
      const markSourceStderrClosed = () => {
        sourceStderrClosed = true;
        scheduleStdioFallback();
        scheduleSuccessfulTargetFallback();
      };
      const markTargetStdinClosed = () => {
        targetStdinClosed = true;
        scheduleStdioFallback();
      };
      const markTargetStdoutClosed = () => {
        targetStdoutClosed = true;
        scheduleStdioFallback();
      };
      const markTargetStderrClosed = () => {
        targetStderrClosed = true;
        scheduleStdioFallback();
      };

      sourceChild.stdout.on('end', markSourceStdoutClosed);
      sourceChild.stdout.on('close', markSourceStdoutClosed);
      sourceChild.stderr?.on('end', markSourceStderrClosed);
      sourceChild.stderr?.on('close', markSourceStderrClosed);
      targetChild.stdin.on('finish', markTargetStdinClosed);
      targetChild.stdin.on('close', markTargetStdinClosed);
      targetChild.stdout?.on('end', markTargetStdoutClosed);
      targetChild.stdout?.on('close', markTargetStdoutClosed);
      targetChild.stderr?.on('end', markTargetStderrClosed);
      targetChild.stderr?.on('close', markTargetStderrClosed);
      timers.processStatePollTimer = setInterval(
        () => {
          if (settled) {
            return;
          }
          syncStdioState();
          syncProcessExitStatus();
          rejectMissingExitedProcesses();
        },
        Math.max(1, options.exitFallbackMs ?? defaultExitFallbackMs)
      );
      sourceChild.stdout.on('error', (error) => {
        sourceState.stderr = appendBounded(sourceState.stderr, error.message, stderrLimit);
        rejectPipeline(
          `Source COPY stream failed: ${plan.source.command} ${sourceState.args.join(' ')}`,
          false,
          true
        );
      });
      targetChild.stdin.on('error', (error) => {
        targetState.stderr = appendBounded(targetState.stderr, error.message, stderrLimit);
        scheduleTargetCopyFailure(
          `Target COPY stream failed: ${plan.target.command} ${targetState.args.join(' ')}`
        );
      });

      sourceChild.on('error', (error) => {
        sourceState.stderr = sourceState.stderr || redactSecrets(error.message);
        rejectPipeline(
          `Source process failed to start: ${plan.source.command} ${sourceState.args.join(' ')}`,
          false,
          true
        );
      });
      targetChild.on('error', (error) => {
        targetState.stderr = targetState.stderr || redactSecrets(error.message);
        rejectPipeline(
          `Target process failed to start: ${plan.target.command} ${targetState.args.join(' ')}`,
          true,
          false
        );
      });
      sourceChild.on('exit', (exitCode, signal) => {
        sourceExited = true;
        sourceState.exitCode = exitCode;
        sourceState.signal = signal;
        completeProcessState(sourceState);
        scheduleSourceInputFallback();
        scheduleExitFallback();
        scheduleStdioFallback();
      });
      targetChild.on('exit', (exitCode, signal) => {
        targetExited = true;
        targetState.exitCode = exitCode;
        targetState.signal = signal;
        completeProcessState(targetState);
        scheduleExitFallback();
        scheduleSuccessfulTargetFallback();
      });

      sourceChild.on('close', (exitCode, signal) => {
        sourceClosed = true;
        sourceExited = true;
        sourceState.exitCode = exitCode;
        sourceState.signal = signal;
        completeProcessState(sourceState);
        if (targetCopyFailurePending && !targetClosed) {
          return;
        }
        if (exitCode !== 0) {
          rejectPipeline(
            `Source process exited with code ${exitCode}: ${plan.source.command} ${sourceState.args.join(' ')}`,
            false,
            true
          );
          return;
        }
        endTargetStdin();
        resolveIfComplete();
      });
      targetChild.on('close', (exitCode, signal) => {
        targetClosed = true;
        targetExited = true;
        targetState.exitCode = exitCode;
        targetState.signal = signal;
        completeProcessState(targetState);
        if (exitCode !== 0) {
          rejectPipeline(
            `Target process exited with code ${exitCode}: ${plan.target.command} ${targetState.args.join(' ')}`,
            true,
            false
          );
          return;
        }
        resolveIfComplete();
        scheduleSuccessfulTargetFallback();
      });

      sourceChild.stdout.pipe(targetChild.stdin);
    });
  }
}
