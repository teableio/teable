import { z } from 'zod';
import { prismaClient } from '@/backend/config/container.config';
import { recordService } from 'server/services/record/record';
import * as fieldService from '../services/field';
import { procedure, router } from '../trpc';

const ssr = {
  async getTables() {
    const tablesMeta = await prismaClient.tableMeta.findMany({
      orderBy: { order: 'asc' },
    });

    return tablesMeta.map((tableMeta) => ({
      ...tableMeta,
      description: tableMeta.description ?? undefined,
      icon: tableMeta.icon ?? undefined,
    }));
  },
};

export const ssrRouter = router({
  // getById: procedure.input(z.number()).query(({ ctx, input }) => {
  //   return prismaClient.user.findFirst({
  //     where: {
  //       id: input,
  //     },
  //   });
  // }),

  getTables: procedure.input(z.string()).query(async ({ ctx, input }) => {
    return ssr.getTables();
  }),

  getSSRSnapshot: procedure
    .input(
      z.object({
        tableId: z.string(),
        viewId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { tableId } = input;
      let viewId = input.viewId;
      if (!input.viewId) {
        const view = await prismaClient.view.findFirstOrThrow({
          where: { tableId },
          select: { id: true },
        });
        viewId = view.id;
      }

      const tables = await ssr.getTables();
      const fields = await fieldService.getFields(tableId, viewId);
      const views = await prismaClient.view.findMany({
        where: {
          tableId,
        },
      });
      const rows = await recordService.getRecords(tableId, {
        viewId,
        skip: 0,
        take: 50,
      });

      return {
        tables,
        fields,
        views,
        rows,
      };
    }),
});
