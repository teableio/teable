import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SpaceDataDbProcessCanceledError,
  SpaceDataDbProcessError,
  SpaceDataDbProcessPipelineCanceledError,
  SpaceDataDbProcessPipelineError,
  SpaceDataDbProcessRunnerService,
  type ISpaceDataDbProcessSpawn,
} from './space-data-db-process-runner.service';

const secretUrl = 'postgresql://user:secret@example/db';
const redactedUrl = 'postgresql://user:***@example/db';
const invalidPercentTokenSecret = 'pa%ss$word';
const copySourceSql = 'COPY (SELECT 1) TO STDOUT';
const copyTargetSql = 'COPY "meta"."record_history" FROM STDIN';
const sharedTableLabel = 'shared-table:record_history';
const pgDumpCommand = 'pg_dump';
const pgRestoreCommand = 'pg_restore';
const pgCustomFormatArg = '--format=custom';

class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdout = new PassThrough();
  readonly pid = 1234;
  readonly kill = vi.fn().mockReturnValue(true);
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
}

const expectProcessTiming = (result: {
  startedAt: string;
  completedAt: string;
  durationMs: number;
}) => {
  expect(Date.parse(result.startedAt)).not.toBeNaN();
  expect(Date.parse(result.completedAt)).not.toBeNaN();
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
};

describe('SpaceDataDbProcessRunnerService', () => {
  let processRef: FakeProcess;
  let spawnProcess: ReturnType<typeof vi.fn<ISpaceDataDbProcessSpawn>>;

  beforeEach(() => {
    processRef = new FakeProcess();
    spawnProcess = vi.fn(() => processRef);
  });

  it('runs commands with spawn arrays and shell disabled', async () => {
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run({
      command: pgDumpCommand,
      args: ['--schema', 'bsexxx', secretUrl],
    });

    processRef.stderr.write('dump complete');
    processRef.emit('close', 0, null);

    const result = await promise;
    expect(result).toMatchObject({
      command: pgDumpCommand,
      args: ['--schema', 'bsexxx', redactedUrl],
      exitCode: 0,
      stderr: 'dump complete',
    });
    expectProcessTiming(result);
    expect(spawnProcess).toHaveBeenCalledWith(
      pgDumpCommand,
      ['--schema', 'bsexxx', secretUrl],
      expect.objectContaining({
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
  });

  it('redacts postgres_fdw user mapping passwords from process args and output', async () => {
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const sql = `CREATE USER MAPPING FOR CURRENT_USER SERVER "srv" OPTIONS (user 'teable', password 'source_secret')`;
    const promise = service.run({
      command: 'psql',
      args: ['--command', sql],
    });

    processRef.stdout.write(`ran ${sql}`);
    processRef.emit('close', 0, null);

    const result = await promise;
    expect(result.args[1]).toContain(`password '***'`);
    expect(result.stdout).toContain(`password '***'`);
  });

  it('keeps stdout and stderr limits independent', async () => {
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run(
      {
        command: pgRestoreCommand,
        args: ['--list'],
      },
      { stdoutLimit: 8, stderrLimit: 4 }
    );

    processRef.stdout.write('stdout-long');
    processRef.stderr.write('stderr-long');
    processRef.emit('close', 0, null);

    const result = await promise;
    expect(result.stdout).toBe('out-long');
    expect(result.stderr).toBe('long');
  });

  it('rejects non-zero exits with redacted args and stderr', async () => {
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run({
      command: pgRestoreCommand,
      args: ['--dbname', secretUrl],
    });

    processRef.stderr.write(`failed ${secretUrl}`);
    processRef.emit('close', 1, null);

    try {
      await promise;
      throw new Error('Expected process to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SpaceDataDbProcessError);
      const result = (error as SpaceDataDbProcessError).result;
      expect(result).toMatchObject({
        command: pgRestoreCommand,
        args: ['--dbname', redactedUrl],
        exitCode: 1,
        stderr: `failed ${redactedUrl}`,
      });
      expectProcessTiming(result);
    }
  });

  it('redacts libpq invalid percent token output from process failures', async () => {
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run({
      command: pgRestoreCommand,
      args: ['--dbname', secretUrl],
    });

    processRef.stderr.write(
      `pg_restore: error: invalid percent-encoded token: "${invalidPercentTokenSecret}"`
    );
    processRef.emit('close', 1, null);

    try {
      await promise;
      throw new Error('Expected process to fail');
    } catch (error) {
      const result = (error as SpaceDataDbProcessError).result;
      expect(result.stderr).toContain('invalid percent-encoded token: "***"');
      expect(result.stderr).not.toContain(invalidPercentTokenSecret);
    }
  });

  it('kills timed-out processes and rejects with a process error', async () => {
    vi.useFakeTimers();
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run(
      {
        command: pgDumpCommand,
        args: ['--schema', 'bsexxx'],
      },
      { timeoutMs: 100 }
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(SpaceDataDbProcessError);

    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(processRef.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('kills running commands when cancellation is requested', async () => {
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run(
      {
        command: pgDumpCommand,
        args: ['--schema', 'bsexxx'],
      },
      { shouldCancel: () => true }
    );

    await expect(promise).rejects.toBeInstanceOf(SpaceDataDbProcessCanceledError);
    expect(processRef.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('polls progress hooks while a command is running', async () => {
    vi.useFakeTimers();
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const onPoll = vi.fn().mockResolvedValue(undefined);
    const promise = service.run(
      {
        command: pgDumpCommand,
        args: ['--schema', 'bsexxx'],
      },
      { pollMs: 50, onPoll }
    );

    await vi.advanceTimersByTimeAsync(50);
    processRef.emit('close', 0, null);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(onPoll).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('rejects a command when a progress poll hangs', async () => {
    vi.useFakeTimers();
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run(
      {
        command: pgDumpCommand,
        args: ['--schema', 'bsexxx'],
      },
      {
        pollMs: 50,
        pollTimeoutMs: 100,
        onPoll: () => new Promise(() => undefined),
      }
    );
    const assertion = expect(promise).rejects.toMatchObject({
      message: expect.stringContaining('Process progress poll timed out after 100ms'),
    });

    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(processRef.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('rejects a command when progress polls keep failing', async () => {
    vi.useFakeTimers();
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run(
      {
        command: pgDumpCommand,
        args: ['--schema', 'bsexxx'],
      },
      {
        pollMs: 50,
        pollFailureTimeoutMs: 100,
        onPoll: () => {
          throw new Error('the database system is in recovery mode');
        },
      }
    );
    const assertion = expect(promise).rejects.toMatchObject({
      message: expect.stringContaining('Process progress poll failed for 100ms'),
    });

    await vi.advanceTimersByTimeAsync(150);

    await assertion;
    expect(processRef.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('resolves a successful command when child exit arrives without close', async () => {
    vi.useFakeTimers();
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run(
      {
        command: pgDumpCommand,
        args: ['--format=directory', secretUrl],
      },
      { exitFallbackMs: 50 }
    );

    processRef.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toMatchObject({
      command: pgDumpCommand,
      args: ['--format=directory', redactedUrl],
      exitCode: 0,
    });
    expectProcessTiming(result);
    vi.useRealTimers();
  });

  it('resolves a successful command when stdio closes before child close arrives', async () => {
    vi.useFakeTimers();
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);
    const promise = service.run(
      {
        command: pgRestoreCommand,
        args: ['--dbname', secretUrl],
      },
      { exitFallbackMs: 50 }
    );

    processRef.stdout.end();
    processRef.stderr.end();
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toMatchObject({
      command: pgRestoreCommand,
      args: ['--dbname', redactedUrl],
      exitCode: 0,
    });
    expectProcessTiming(result);
    vi.useRealTimers();
  });

  it('pipes source stdout into target stdin with shell disabled', async () => {
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    const targetChunks: Buffer[] = [];
    targetProcess.stdin.on('data', (chunk: Buffer) => targetChunks.push(chunk));
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline({
      source: {
        command: 'psql',
        args: ['--command', copySourceSql, secretUrl],
      },
      target: {
        command: 'psql',
        args: ['--command', copyTargetSql, secretUrl],
      },
    });

    sourceProcess.stdout.write('row-1\n');
    sourceProcess.stdout.end('row-2\n');
    sourceProcess.emit('close', 0, null);
    targetProcess.stdout.write('COPY 2\n');
    targetProcess.emit('close', 0, null);

    const result = await promise;
    expect(result).toMatchObject({
      source: { command: 'psql', args: ['--command', copySourceSql, redactedUrl] },
      target: {
        command: 'psql',
        args: ['--command', copyTargetSql, redactedUrl],
        stdout: 'COPY 2\n',
      },
    });
    expectProcessTiming(result.source);
    expectProcessTiming(result.target);
    expect(Buffer.concat(targetChunks).toString('utf8')).toBe('row-1\nrow-2\n');
    expect(spawnProcess).toHaveBeenNthCalledWith(
      1,
      'psql',
      ['--command', copySourceSql, secretUrl],
      expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    );
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      'psql',
      ['--command', copyTargetSql, secretUrl],
      expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    );
  });

  it('resolves a successful pipeline when child exit events arrive without close events', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      { exitFallbackMs: 50 }
    );

    sourceProcess.emit('exit', 0, null);
    targetProcess.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toMatchObject({
      source: { command: pgDumpCommand, exitCode: 0 },
      target: { command: pgRestoreCommand, exitCode: 0 },
    });
    expectProcessTiming(result.source);
    expectProcessTiming(result.target);
    vi.useRealTimers();
  });

  it('resolves a successful pipeline when stdio closes before child close events arrive', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      { exitFallbackMs: 50 }
    );

    sourceProcess.stdout.end();
    sourceProcess.stderr.end();
    targetProcess.stdin.end();
    targetProcess.stdout.end();
    targetProcess.stderr.end();
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toMatchObject({
      source: { command: pgDumpCommand, exitCode: 0 },
      target: { command: pgRestoreCommand, exitCode: 0 },
    });
    expectProcessTiming(result.source);
    expectProcessTiming(result.target);
    vi.useRealTimers();
  });

  it('ends target stdin when source exits before stdout closes', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      { exitFallbackMs: 50 }
    );
    targetProcess.stdin.on('finish', () => {
      targetProcess.emit('exit', 0, null);
      targetProcess.emit('close', 0, null);
    });

    sourceProcess.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toMatchObject({
      source: { command: pgDumpCommand, exitCode: 0 },
      target: { command: pgRestoreCommand, exitCode: 0 },
    });
    expectProcessTiming(result.source);
    expectProcessTiming(result.target);
    vi.useRealTimers();
  });

  it('resolves a successful pipeline when source stdio closes and target exits before source close arrives', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      { exitFallbackMs: 50 }
    );

    sourceProcess.stdout.end();
    sourceProcess.stderr.end();
    targetProcess.emit('exit', 0, null);
    targetProcess.emit('close', 0, null);
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toMatchObject({
      source: { command: pgDumpCommand, exitCode: 0 },
      target: { command: pgRestoreCommand, exitCode: 0 },
    });
    expectProcessTiming(result.source);
    expectProcessTiming(result.target);
    vi.useRealTimers();
  });

  it('resolves a successful pipeline when source exits and target stdio closes before target exit arrives', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      { exitFallbackMs: 50 }
    );

    sourceProcess.emit('exit', 0, null);
    targetProcess.stdin.end();
    targetProcess.stdout.end();
    targetProcess.stderr.end();
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toMatchObject({
      source: { command: pgDumpCommand, exitCode: 0 },
      target: { command: pgRestoreCommand, exitCode: 0 },
    });
    expectProcessTiming(result.source);
    expectProcessTiming(result.target);
    vi.useRealTimers();
  });

  it('resolves a successful pipeline when child exit status changes without exit or close events', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      { exitFallbackMs: 50 }
    );

    sourceProcess.stdout.end();
    sourceProcess.stderr.end();
    targetProcess.stdin.end();
    targetProcess.stdout.end();
    targetProcess.stderr.end();
    sourceProcess.exitCode = 0;
    targetProcess.exitCode = 0;
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toMatchObject({
      source: { command: pgDumpCommand, exitCode: 0 },
      target: { command: pgRestoreCommand, exitCode: 0 },
    });
    expectProcessTiming(result.source);
    expectProcessTiming(result.target);
    vi.useRealTimers();
  });

  it('rejects a pipeline when a child process disappears without exit or close events', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    sourceProcess.kill.mockImplementation((signal?: NodeJS.Signals | 0) =>
      signal === 0 ? false : true
    );
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      { exitFallbackMs: 50 }
    );
    const assertion = expect(promise).rejects.toMatchObject({
      message: expect.stringContaining('exited without status'),
      result: expect.objectContaining({
        source: expect.objectContaining({
          exitCode: null,
          signal: null,
        }),
      }),
    });

    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    expect(targetProcess.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('rejects a pipeline when a progress poll hangs', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      {
        pollMs: 50,
        pollTimeoutMs: 100,
        onPoll: () => new Promise(() => undefined),
      }
    );
    const assertion = expect(promise).rejects.toMatchObject({
      message: expect.stringContaining('Process progress poll timed out after 100ms'),
      result: expect.objectContaining({
        source: expect.objectContaining({ signal: 'SIGTERM' }),
        target: expect.objectContaining({ signal: 'SIGTERM' }),
      }),
    });

    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(sourceProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(targetProcess.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('rejects a pipeline when progress polls keep failing', async () => {
    vi.useFakeTimers();
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: {
          command: pgDumpCommand,
          args: [pgCustomFormatArg, secretUrl],
        },
        target: {
          command: pgRestoreCommand,
          args: ['--dbname', secretUrl],
        },
      },
      {
        pollMs: 50,
        pollFailureTimeoutMs: 100,
        onPoll: () => {
          throw new Error('the database system is in recovery mode');
        },
      }
    );
    const assertion = expect(promise).rejects.toMatchObject({
      message: expect.stringContaining('Process progress poll failed for 100ms'),
      result: expect.objectContaining({
        source: expect.objectContaining({ signal: 'SIGTERM' }),
        target: expect.objectContaining({ signal: 'SIGTERM' }),
      }),
    });

    await vi.advanceTimersByTimeAsync(150);

    await assertion;
    expect(sourceProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(targetProcess.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('kills the target process when the source COPY process exits non-zero', async () => {
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline({
      source: { command: 'psql', args: ['--command', 'COPY bad TO STDOUT', secretUrl] },
      target: { command: 'psql', args: ['--command', 'COPY good FROM STDIN', secretUrl] },
      label: sharedTableLabel,
    });

    sourceProcess.stderr.write(`source failed ${secretUrl}`);
    sourceProcess.emit('close', 1, null);

    await expect(promise).rejects.toMatchObject({
      result: expect.objectContaining({
        label: sharedTableLabel,
        source: expect.objectContaining({
          exitCode: 1,
          stderr: `source failed ${redactedUrl}`,
        }),
      }),
    });
    await expect(promise).rejects.toBeInstanceOf(SpaceDataDbProcessPipelineError);
    expect(targetProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('redacts libpq invalid percent token output from pipeline failures', async () => {
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline({
      source: { command: pgDumpCommand, args: [pgCustomFormatArg, secretUrl] },
      target: { command: pgRestoreCommand, args: ['--dbname', secretUrl] },
      label: 'base-schemas',
    });

    targetProcess.stderr.write(
      `pg_restore: error: invalid percent-encoded token: "${invalidPercentTokenSecret}"`
    );
    targetProcess.emit('close', 1, null);

    await expect(promise).rejects.toMatchObject({
      result: expect.objectContaining({
        target: expect.objectContaining({
          stderr: expect.stringContaining('invalid percent-encoded token: "***"'),
        }),
      }),
    });
    await expect(promise).rejects.toBeInstanceOf(SpaceDataDbProcessPipelineError);
  });

  it('kills both COPY processes when cancellation is requested', async () => {
    const sourceProcess = new FakeProcess();
    const targetProcess = new FakeProcess();
    spawnProcess = vi.fn().mockReturnValueOnce(sourceProcess).mockReturnValueOnce(targetProcess);
    const service = new SpaceDataDbProcessRunnerService(spawnProcess);

    const promise = service.runPipeline(
      {
        source: { command: 'psql', args: ['--command', 'COPY source TO STDOUT', secretUrl] },
        target: { command: 'psql', args: ['--command', 'COPY target FROM STDIN', secretUrl] },
        label: sharedTableLabel,
      },
      { shouldCancel: () => true }
    );

    await expect(promise).rejects.toBeInstanceOf(SpaceDataDbProcessPipelineCanceledError);
    expect(sourceProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(targetProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
