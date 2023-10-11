/**
 * Convenience singleton to deal with fast-refresh
 * and connection limits in development mode.
 */
import type { Prisma } from '@prisma/client';

export class PrismaManager {
  static extendTransaction(tx: Prisma.TransactionClient) {
    return new Proxy(tx, {
      get(target, p) {
        if (p === '$transaction') {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          return async (func) => func(tx);
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return target[p];
      },
    });
  }
}
