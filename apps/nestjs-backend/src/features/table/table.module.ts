import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TableController } from './table.controller';
import { TableService } from './table.service';

@Module({
  controllers: [TableController],
  providers: [TableService, PrismaService],
})
export class TableModule {}
