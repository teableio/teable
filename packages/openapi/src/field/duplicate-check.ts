import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { crossSpaceTableAffectedFieldSchema } from '../table/duplicate-check';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DUPLICATE_FIELD_CHECK =
  '/base/{baseId}/table/{tableId}/field/{fieldId}/duplicate-check';

export const duplicateFieldCheckVoSchema = z.object({
  affectedFields: z.array(crossSpaceTableAffectedFieldSchema),
});

export type IDuplicateFieldCheckVo = z.infer<typeof duplicateFieldCheckVoSchema>;

export const DuplicateFieldCheckRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DUPLICATE_FIELD_CHECK,
  description:
    'Check whether this field would be downgraded to single line text on duplicate due to cross-space references. Returns an empty list when no downgrade is needed.',
  summary: 'Check cross-space affected fields for field duplicate',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'The list of cross-space affected fields (empty or single-entry).',
      content: {
        'application/json': {
          schema: duplicateFieldCheckVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const duplicateFieldCheck = async (baseId: string, tableId: string, fieldId: string) => {
  return axios.get<IDuplicateFieldCheckVo>(
    urlBuilder(DUPLICATE_FIELD_CHECK, { baseId, tableId, fieldId })
  );
};
