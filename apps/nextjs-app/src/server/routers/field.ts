import { z } from 'zod';
import { fieldService } from 'server/services/field/field.service';
import { procedure, router } from '../trpc';

export const fieldRouter = router({
  getFields: procedure
    .input(
      z.object({
        tableId: z.string(),
        query: z.object({
          viewId: z.string(),
        }),
      })
    )
    .query(async ({ input }) => {
      const { tableId, query } = input;
      return fieldService.getFields(tableId, query);
    }),
});
