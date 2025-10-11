export function conditionalQueueProcessorProviders<T>(...providers: T[]): T[] {
  return process.env.BACKEND_DISABLE_QUEUE_CONSUMER === 'true' ? [] : providers;
}
