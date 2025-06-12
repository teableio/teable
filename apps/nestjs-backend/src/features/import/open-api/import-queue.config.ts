/**
 * 导入队列的并发配置
 * 统一管理所有导入相关队列的并发参数
 */

// CSV分块导入队列并发配置
export const TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY = 20;

// CSV导入队列并发配置
export const TABLE_IMPORT_CSV_QUEUE_CONCURRENCY = 15;

// 通用队列配置选项
export const importQueueOptions = {
  maxStalledCount: 3,
  stalledInterval: 30000,
  removeOnComplete: {
    count: 1000,
  },
  removeOnFail: {
    count: 2000,
  },
};

// 获取分块处理队列配置
export const getChunkQueueOptions = () => ({
  concurrency: TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY,
  ...importQueueOptions,
});

// 获取常规导入队列配置
export const getCsvQueueOptions = () => ({
  concurrency: TABLE_IMPORT_CSV_QUEUE_CONCURRENCY,
  ...importQueueOptions,
});
