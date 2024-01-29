/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LogLevel } from '@nestjs/common';
import { ConsoleLogger } from '@nestjs/common';

export class TestingLogger extends ConsoleLogger {
  constructor() {
    const testLogLevel = (process.env.TEST_LOG_LEVEL ?? '').split(',') as LogLevel[];

    super('Testing', {
      logLevels: testLogLevel?.length > 0 ? testLogLevel : undefined,
    });
  }

  log(message: string, ...optionalParams: any[]) {
    if (!this.isLevelEnabled('log')) {
      return;
    }
    console.log(message, optionalParams);
  }

  warn(message: string) {
    if (!this.isLevelEnabled('warn')) {
      return;
    }
    console.warn(message);
  }

  debug(message: string, ...optionalParams: any[]) {
    if (!this.isLevelEnabled('debug')) {
      return;
    }
    console.debug(message, optionalParams);
  }

  verbose(message: string) {
    if (!this.isLevelEnabled('verbose')) {
      return;
    }
    console.log(message);
  }

  error(message: string, ...optionalParams: any[]) {
    if (!this.isLevelEnabled('error')) {
      return;
    }
    console.error(message, optionalParams);
  }
}
