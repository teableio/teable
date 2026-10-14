import type { IEnv } from './config.js';
import type { ILogger } from './logger.js';

export interface ITeableRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface IListRecordsOptions {
  viewId?: string;
  take?: number;
}

export interface ITeableClient {
  listRecords(tableId: string, options?: IListRecordsOptions): Promise<ITeableRecord[]>;
  notifyInApp(params: {
    message: string;
    severity?: 'info' | 'warning' | 'critical';
    path?: string;
    toUserId?: string[];
    toEmail?: string[];
  }): Promise<{ sentCount: number; invalidUserIds?: string[]; invalidEmails?: string[] }>;
}

/**
 * Minimal REST client for the Teable instance. Uses the personal access token
 * (Bearer) and string-formatted cells keyed by field name so digest rendering
 * needs no field metadata.
 */
export const createTeableClient = (env: IEnv, logger: ILogger): ITeableClient => {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const url = new URL(path, env.SSA_TEABLE_BASE_URL);
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(env.SSA_TEABLE_API_TOKEN
          ? { authorization: `Bearer ${env.SSA_TEABLE_API_TOKEN}` }
          : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Teable API ${init?.method ?? 'GET'} ${url.pathname} -> HTTP ${response.status} ${body.slice(
          0,
          300
        )}`
      );
    }
    return (await response.json()) as T;
  };

  return {
    async listRecords(tableId, options = {}) {
      const params = new URLSearchParams({
        fieldKeyType: 'name',
        cellFormat: 'text',
        take: String(options.take ?? 10),
      });
      if (options.viewId) {
        params.set('viewId', options.viewId);
      }
      const result = await request<{ records?: ITeableRecord[] }>(
        `/api/table/${tableId}/record?${params.toString()}`
      );
      return result.records ?? [];
    },

    async notifyInApp(params) {
      if (!env.SSA_INTERNAL_TOKEN) {
        throw new Error('SSA_INTERNAL_TOKEN is not configured');
      }
      const result = await request<{
        sentCount: number;
        invalidUserIds?: string[];
        invalidEmails?: string[];
      }>('/api/ssa/notify', {
        method: 'POST',
        headers: { 'x-ssa-token': env.SSA_INTERNAL_TOKEN },
        body: JSON.stringify({
          message: params.message,
          severity: params.severity,
          path: params.path,
          toUserId: params.toUserId,
          toEmail: params.toEmail,
        }),
      });
      logger.debug('in-app notification sent', result);
      return result;
    },
  };
};
