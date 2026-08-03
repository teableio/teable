import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context, trace } from '@opentelemetry/api';
import { ClsService } from 'nestjs-cls';
import { LoggerModule as BaseLoggerModule } from 'nestjs-pino';
import type { ILoggerConfig } from '../configs/logger.config';
import { X_REQUEST_ID } from '../const';
import type { IClsStore } from '../types/cls';

@Module({})
export class LoggerModule {
  static register(): DynamicModule {
    return BaseLoggerModule.forRootAsync({
      inject: [ClsService, ConfigService],
      useFactory: (cls: ClsService<IClsStore>, config: ConfigService) => {
        const { level } = config.getOrThrow<ILoggerConfig>('logger');
        const env = process.env.NODE_ENV;
        const isCi = ['true', '1'].includes(process.env?.CI ?? '');

        const disableAutoLogging = isCi || env === 'test';
        const shouldAutoLog = !disableAutoLogging && (env === 'production' || level === 'debug');

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
            // Disable automatic HTTP request logging in CI and tests
            autoLogging: shouldAutoLog
              ? {
                  ignore: (req) => {
                    const url = req.url;
                    if (!url) return false;

                    if (url.startsWith('/_next')) return true;
                    if (url.startsWith('/__next')) return true;
                    if (url === '/favicon.ico') return true;
                    if (url.startsWith('/.well-known/')) return true;
                    if (url === '/health' || url === '/ping') return true;
                    if (req.headers.upgrade === 'websocket') return true;
                    return false;
                  },
                }
              : false,
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const sessionId = (object as any)?.res?.req?.sessionID;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const reqPath = (object as any)?.res?.req?.route?.path;
                return {
                  ...object,
                  route: reqPath,
                  is_access_token: Boolean(cls.get('accessTokenId')),
                  user_id: cls.get('user.id'),
                  session_id: sessionId,
                  spanId,
                  traceId,
                };
              },
            },
          },
        };
      },
    });
  }
}
