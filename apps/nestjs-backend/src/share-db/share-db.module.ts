import { Module } from '@nestjs/common';
import { AuthModule } from '../features/auth/auth.module';
import { CalculationModule } from '../features/calculation/calculation.module';
import { ShareModule } from '../features/share/share.module';
import { TableModule } from '../features/table/table.module';
import { UserModule } from '../features/user/user.module';
import { ShareDbPermissionService } from './share-db-permission.service';
import { ShareDbAdapter } from './share-db.adapter';
import { ShareDbService } from './share-db.service';
import { WsAuthService } from './ws-auth.service';
import { WsDerivateService } from './ws-derivate.service';

@Module({
  imports: [TableModule, CalculationModule, AuthModule, UserModule, ShareModule],
  providers: [
    ShareDbService,
    ShareDbAdapter,
    WsDerivateService,
    WsAuthService,
    ShareDbPermissionService,
  ],
  exports: [ShareDbService, WsAuthService],
})
export class ShareDbModule {}
