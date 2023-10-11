import type { DynamicModule } from '@nestjs/common';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { ILoggerConfig } from 'src/configs/logger.config';
import { X_REQUEST_ID } from '../const';

@Module({})
export class TeableLoggerModule {
  static register(): DynamicModule {
    return LoggerModule.forRootAsync({
      inject: [ClsService, ConfigService],
      useFactory: (cls: ClsService, config: ConfigService) => {
        const { level } = config.getOrThrow<ILoggerConfig>('logger');

        return {
          pinoHttp: {
            name: 'teable',
            autoLogging: process.env.NODE_ENV === 'production',
            level: level,
            quietReqLogger: true,
            genReqId: (req, res) => {
              const existingID = req.id ?? req.headers[X_REQUEST_ID];
              if (existingID) return existingID;
              const id = cls.getId();
              res.setHeader(X_REQUEST_ID, id);
              return id;
            },
            transport:
              process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
          },
          exclude: [
            '_next/(.*)',
            '__nextjs(.*)',
            'images/(.*)',
            'favicon.ico',
            {
              path: 'space/(.*)?',
              method: RequestMethod.GET,
            },
          ],
        };
      },
    });
  }
}
