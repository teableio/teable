import { z } from 'zod';
import * as fieldService from 'server/services/field';
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
      return fieldService.getFields(tableId, query.viewId);
    }),
});
