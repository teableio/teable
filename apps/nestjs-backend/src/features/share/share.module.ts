import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DbProvider } from '../../db-provider/db.provider';
import { AggregationModule } from '../aggregation/aggregation.module';
import { AuthModule } from '../auth/auth.module';
import { FieldModule } from '../field/field.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SelectionModule } from '../selection/selection.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    AuthModule,
    PassportModule,
    FieldModule,
    RecordModule,
    RecordOpenApiModule,
    SelectionModule,
    AggregationModule,
  ],
  providers: [ShareService, JwtStrategy, DbProvider],
  controllers: [ShareController],
  exports: [ShareService],
})
export class ShareModule {}
