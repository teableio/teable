import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldPermissionService } from './field-permission.service';
import { FieldService } from './field.service';

@Module({
  imports: [CalculationModule],
  providers: [FieldService, DbProvider, FieldPermissionService],
  exports: [FieldService],
})
export class FieldModule {}
