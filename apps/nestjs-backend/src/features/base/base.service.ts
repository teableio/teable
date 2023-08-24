import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class BaseService {
  constructor(private readonly prismaService: PrismaService) {}

  sqlQuery(sql: string, bindings: unknown[]) {
    return this.prismaService.$queryRawUnsafe(sql, ...bindings);
  }
}
