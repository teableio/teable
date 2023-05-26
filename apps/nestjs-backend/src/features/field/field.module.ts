import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FieldSupplementService } from './field-supplement.service';
import { FieldService } from './field.service';

@Module({
  providers: [FieldService, FieldSupplementService, PrismaService],
  exports: [FieldService, FieldSupplementService, PrismaService],
})
export class FieldModule {}
