import { Module } from '@nestjs/common';
import { FieldController } from './field.controller';
import { FieldService } from './field.service';

@Module({
  providers: [FieldService],
  controllers: [FieldController],
})
export class FieldModule {}
