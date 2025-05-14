import type { IChatMessageUsage } from '@teable/openapi';

export interface IMessageMeta {
  timeCost?: number;
  usage?: IChatMessageUsage;
}
