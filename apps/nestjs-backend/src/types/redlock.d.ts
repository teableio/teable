/* eslint-disable @typescript-eslint/naming-convention */
declare module 'redlock' {
  export class ExecutionError extends Error {
    attempts: any[];
  }

  export class ResourceLockedError extends ExecutionError {}

  export interface RedlockAbortSignal {
    readonly aborted: boolean;
    readonly error?: Error;
  }

  export interface Settings {
    driftFactor?: number;
    retryCount?: number;
    retryDelay?: number;
    retryJitter?: number;
    automaticExtensionThreshold?: number;
  }

  export interface ExecutionResult<T> {
    attempts: any[];
    value?: T;
  }

  export class Lock {
    readonly resources: string[];
    readonly expiration: number;
  }

  export default class Redlock {
    constructor(clients: any[], settings?: Settings);

    acquire(resources: string[], duration: number, settings?: Partial<Settings>): Promise<Lock>;

    release(lock: Lock, settings?: Partial<Settings>): Promise<ExecutionResult<void>>;

    extend(lock: Lock, duration: number, settings?: Partial<Settings>): Promise<Lock>;

    using<T>(
      resources: string[],
      duration: number,
      routine: (signal: RedlockAbortSignal) => Promise<T>,
      settings?: Partial<Settings>
    ): Promise<T>;

    on(event: string, listener: (...args: any[]) => void): this;

    quit(): Promise<void>;
  }
}
