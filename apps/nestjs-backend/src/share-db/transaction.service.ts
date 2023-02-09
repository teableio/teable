import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../src/prisma.service';

@Injectable()
export class TransactionService {
  constructor(private readonly prismaService: PrismaService) {}
  transactionClient: Map<string, Prisma.TransactionClient> = new Map();

  get(id: string) {
    const client = this.transactionClient.get(id);
    if (!client) {
      return this.prismaService;
    }
    return client;
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
