import { getQueueToken } from '@nestjs/bullmq';
import type { Provider } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import type { JobsOptions } from 'bullmq';
import { localQueueEventEmitter } from './event-emitter';

export interface ILocalJob {
  id: string;
  name: string;
  data: unknown;
  opts?: JobsOptions;
  queueName: string;
  progress: number | object;
  returnvalue: unknown;
  failedReason?: string;
  state: string;
  getState: () => Promise<string>;
  updateProgress: (progress: number | object) => Promise<void>;
}

export const createLocalQueueProvider = (queueName: string): Provider => ({
  provide: getQueueToken(queueName),
  useFactory: async () => {
    const jobs = new Map<string, ILocalJob>();

    const createJob = (id: string, name: string, data: unknown, opts?: JobsOptions): ILocalJob => {
      const job: ILocalJob = {
        id,
        name,
        data,
        opts,
        queueName,
        progress: 0,
        returnvalue: undefined,
        failedReason: undefined,
        state: 'waiting',
        getState: async () => job.state,
        updateProgress: async (p: number | object) => {
          job.progress = p;
        },
      };
      return job;
    };

    return {
      add: (name: string, data: unknown, opts?: JobsOptions) => {
        const id = opts?.jobId ?? getRandomString(10);
        const job = createJob(id, name, data, opts);
        jobs.set(id, job);
        localQueueEventEmitter.emit(`handle-listener-${queueName}`, job);
        return job;
      },
      addBulk: (bulkJobs: JobsOptions[]) => {
        bulkJobs.forEach((job) => {
          localQueueEventEmitter.emit(`handle-listener-${queueName}`, job);
        });
      },
      getJob: async (jobId: string) => {
        return jobs.get(jobId) ?? null;
      },
      getJobs: async () => {
        return Array.from(jobs.values());
      },
      getJobCountByTypes: async () => {
        return jobs.size;
      },
    };
  },
});
