import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShareDbModule } from '../share-db/share-db.module';
import { ShareDbService } from '../share-db/share-db.service';
import { WsGateway } from './ws.gateway';
import { DevWsGateway } from './ws.gateway.dev';
import { WsService } from './ws.service';

@Module({
  imports: [ShareDbModule],
  providers: [
    WsService,
    {
      provide: 'WsGateway',
      inject: [ShareDbService, ConfigService],
      useFactory: (shareDb: ShareDbService, configService: ConfigService) => {
        if (process.env.NODE_ENV === 'production') {
          return new WsGateway(shareDb);
        } else {
          return new DevWsGateway(shareDb, configService);
        }
      },
    },
  ],
})
export class WsModule {}
