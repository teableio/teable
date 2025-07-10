import { Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { thresholdConfig } from '../configs/threshold.config';
import { CustomHttpException } from '../custom.exception';

const logger = new Logger('RetryDecorator');

const retryCodes = ['40P01', 'P2034'];

export function retryOnDeadlock(opt?: {
  maxRetries: number;
  initialBackoff: number;
  jitter: number;
}) {
  const { dbDeadlock } = thresholdConfig();
  const {
    maxRetries = dbDeadlock.maxRetries,
    initialBackoff = dbDeadlock.initialBackoff,
    jitter = dbDeadlock.jitter,
  } = opt ?? {};

  return function (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      let retries = 0;
      let backoff = initialBackoff + Math.random() * jitter;
      while (retries <= maxRetries) {
        try {
          return await originalMethod.apply(this, args);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          if (
            retryCodes.includes(error.code) ||
            (error.meta?.code && retryCodes.includes(error.meta.code as string))
          ) {
            if (retries === maxRetries) {
              logger.error(
                `Database deadlock after ${retries} retries (code: ${error.code})`,
                error.stack
              );
              throw new CustomHttpException(
                'Database deadlock detected',
                HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE
              );
            }
            await new Promise((resolve) => setTimeout(resolve, backoff));
            backoff *= 1.5 + Math.random() * jitter;
          } else {
            throw error;
          }
        }
        retries++;
      }
    };

    return descriptor;
  };
}
