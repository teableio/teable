import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FieldController } from './field.controller';
import { FieldService } from './field.service';

@Module({
  providers: [FieldService, PrismaService],
  controllers: [FieldController],
  exports: [FieldService],
})
export class FieldModule {}
