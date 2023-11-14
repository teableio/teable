import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DbProvider } from '../../db-provider/db.provider';
import { AggregationService } from '../aggregation/aggregation.service';
import { AggregationOpenApiService } from '../aggregation/open-api/aggregation-open-api.service';
import { AuthModule } from '../auth/auth.module';
import { FieldModule } from '../field/field.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [AuthModule, PassportModule, FieldModule, RecordModule, RecordOpenApiModule],
  providers: [ShareService, JwtStrategy, DbProvider, AggregationService, AggregationOpenApiService],
  controllers: [ShareController],
  exports: [ShareService],
})
export class ShareModule {}
