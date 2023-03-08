import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../src/prisma.service';

@Injectable()
export class TransactionService {
  constructor(private readonly prismaService: PrismaService) {}
  transactionClient: Map<string, Prisma.TransactionClient> = new Map();

  get(id: string) {
    return this.transactionClient.get(id);
  }

  async newTransaction() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tranPromiseCb: { resolve: (value: unknown) => void; reject: (reason?: any) => void };
    const transactionPromise = new Promise((resolve, reject) => {
      tranPromiseCb = { resolve, reject };
    });

    let prismaResolveFn: (value: Prisma.TransactionClient) => void;
    const prismaPromise = new Promise<Prisma.TransactionClient>((resolve) => {
      prismaResolveFn = resolve;
    });

    this.prismaService.$transaction(async (prisma) => {
      console.log('transaction start');
      prismaResolveFn(prisma);
      await transactionPromise;
      console.log('transaction done');
    });

    const prismaClient = await prismaPromise;
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      prisma: prismaClient!,
      endTransaction: (err?: unknown) => {
        if (err) {
          tranPromiseCb.reject(err);
        } else {
          tranPromiseCb.resolve(undefined);
        }
      },
    };
  }

  set(id: string, client: Prisma.TransactionClient) {
    if (this.transactionClient.get(id)) {
      throw new Error(`Transaction ${id} already exists`);
    }
    this.transactionClient.set(id, client);
  }

  remove(id: string) {
    const client = this.transactionClient.get(id);
    if (!client) {
      throw new Error(`Transaction ${id} doesn't exist`);
    }
    this.transactionClient.delete(id);
  }
}
