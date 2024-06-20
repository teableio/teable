import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context, trace } from '@opentelemetry/api';
import { ClsService } from 'nestjs-cls';
import { LoggerModule as BaseLoggerModule } from 'nestjs-pino';
import type { ILoggerConfig } from '../configs/logger.config';
import { X_REQUEST_ID } from '../const';

@Module({})
export class LoggerModule {
  static register(): DynamicModule {
    return BaseLoggerModule.forRootAsync({
      inject: [ClsService, ConfigService],
      useFactory: (cls: ClsService, config: ConfigService) => {
        const { level } = config.getOrThrow<ILoggerConfig>('logger');

        return {
          pinoHttp: {
            serializers: {
              req(req) {
                delete req.headers;
                return req;
              },
              res(res) {
                delete res.headers;
                return res;
              },
            },
            name: 'teable',
            level: level,
            autoLogging: process.env.NODE_ENV === 'production',
            genReqId: (req, res) => {
              const existingID = req.id ?? req.headers[X_REQUEST_ID];
              if (existingID) return existingID;
              const id = cls.getId();
              res.setHeader(X_REQUEST_ID, id);
              return id;
            },
            transport:
              process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
            formatters: {
              log(object) {
                const span = trace.getSpan(context.active());
                if (!span) return { ...object };
                const { traceId, spanId } = span.spanContext();
                return { ...object, spanId, traceId };
              },
            },
          },
        };
      },
    });
  }
}
