import { z } from 'zod';
import { tableOpenApiService } from 'server/services/table/open-api/table-open-api.service';
import { procedure, router } from 'server/trpc';

export const iCreateTableRoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  views: z.array(z.any()).optional(),
  fields: z.array(z.any()).optional(),
  rows: z.any().optional(),
});

export const tableRouter = router({
  createTable: procedure
    .meta({ /* 👉 */ openapi: { method: 'POST', path: '/table' } })
    .input(iCreateTableRoSchema)
    .output(
      iCreateTableRoSchema.extend({
        id: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await tableOpenApiService.createTable(input);
    }),
});
