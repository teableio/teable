import type { IComputedOutboxWakeupPublisher } from '@teable/v2-adapter-table-repository-postgres';

/** App-level publisher contract used by BullMQ consumers to authorize follow-up wake-ups. */
export interface IComputedOutboxWakeupAppPublisher extends IComputedOutboxWakeupPublisher {
  runAsConsumer<T>(operation: () => Promise<T>): Promise<T>;
  onDeliveryRecovered(listener: () => void): () => void;
}
