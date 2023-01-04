import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FieldCommandService } from './field-command.service';
import { FieldController } from './field.controller';
import { FieldService } from './field.service';

@Module({
  providers: [FieldService, PrismaService, FieldCommandService],
  controllers: [FieldController],
  exports: [FieldService],
})
export class FieldModule {}
