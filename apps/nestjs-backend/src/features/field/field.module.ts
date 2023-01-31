import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FieldService } from './field.service';

@Module({
  providers: [FieldService, PrismaService],
  exports: [FieldService, PrismaService],
})
export class FieldModule {}
