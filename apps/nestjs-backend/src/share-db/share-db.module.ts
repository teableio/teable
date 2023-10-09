import { Module } from '@nestjs/common';
import { AuthModule } from '../features/auth/auth.module';
import { CalculationModule } from '../features/calculation/calculation.module';
import { TableModule } from '../features/table/table.module';
import { UserModule } from '../features/user/user.module';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { WsAuthService } from './ws-auth.service';

@Module({
  imports: [TableModule, CalculationModule, AuthModule, UserModule],
  providers: [ShareDbService, SqliteDbAdapter, DerivateChangeService, WsAuthService],
  exports: [ShareDbService, WsAuthService],
})
export class ShareDbModule {}
