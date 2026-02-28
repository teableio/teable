import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';

export const aiKeyStatsVoSchema = z.object({
  groups: z.record(
    z.string(),
    z.object({
      keys: z.array(
        z.object({
          index: z.number(),
          fingerprint: z.string(),
          totalRequests: z.number(),
          totalFailures: z.number(),
          activeRequests: z.number(),
          lastUsedAt: z.number().nullable(),
          isActive: z.boolean(),
          lastError: z.string().nullable(),
        })
      ),
      totalSlots: z.number(),
      activeSlots: z.number(),
      waitingCount: z.number(),
    })
  ),
});

export type IAiKeyStatsVo = z.infer<typeof aiKeyStatsVoSchema>;

export const AI_KEY_STATS = '/admin/setting/ai-key-stats';

export const AiKeyStatsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AI_KEY_STATS,
  description: 'Get per-key usage statistics for AI Gateway API keys',
  responses: {
    200: {
      description: 'Key statistics by group',
      content: {
        'application/json': {
          schema: aiKeyStatsVoSchema,
        },
      },
    },
  },
  tags: ['admin', 'setting'],
});

export const getAiKeyStats = async (): Promise<IAiKeyStatsVo> => {
  const response = await axios.get<IAiKeyStatsVo>(AI_KEY_STATS);
  return response.data;
};
