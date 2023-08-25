import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class BaseService {
  private logger = new Logger(BaseService.name);

  constructor(private readonly prismaService: PrismaService) {}

  sqlQuery(sql: string, bindings: unknown[]) {
    this.logger.log('sqlQuery:sql: ' + sql);
    this.logger.log('sqlQuery:binding: ' + bindings);
    return this.prismaService.$queryRawUnsafe(sql, ...bindings);
  }
}
