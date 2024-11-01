import { getQueueToken } from '@nestjs/bullmq';
import type { Provider } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import type { JobsOptions } from 'bullmq';
import { localQueueEventEmitter } from './event-emitter';

export const createLocalQueueProvider = (queueName: string): Provider => ({
  provide: getQueueToken(queueName),
  useFactory: async () => {
    return {
      add: (name: string, data: unknown, opts?: JobsOptions) => {
        localQueueEventEmitter.emit('handle-listener', {
          id: getRandomString(10),
          name,
          data,
          opts,
          queueName,
        });
      },
      addBulk: (jobs: JobsOptions[]) => {
        jobs.forEach((job) => {
          localQueueEventEmitter.emit('handle-listener', job);
        });
      },
    };
  },
});
