import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { isDomainError, toError } from '@teable/v2-core';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import isPortReachable from 'is-port-reachable';
import { ClsService } from 'nestjs-cls';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { IBaseConfig } from './configs/base.config';
import type { ISecurityWebConfig, IApiDocConfig } from './configs/bootstrap.config';
import { GlobalExceptionFilter } from './filter/global-exception.filter';
import { setupSwagger } from './swagger';
import type { IClsStore } from './types/cls';
import { nestModuleIdOptions, nestRouteDiagnosticsOptions } from './utils/nest-module-id-options';
import { relaxOAuthPopupCoop } from './utils/oauth-popup-coop';

const host = 'localhost';

export async function setUpAppMiddleware(app: INestApplication, configService: ConfigService) {
  app.useGlobalFilters(
    new GlobalExceptionFilter(configService, app.get<ClsService<IClsStore>>(ClsService))
  );
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, stopAtFirstError: true, forbidUnknownValues: false })
  );
  // HSTS is configured at the WAF level. Disable it here to avoid sending duplicate
  // `Strict-Transport-Security` headers with potentially different max-age values.
  app.use(helmet({ hsts: false }));
  app.use(relaxOAuthPopupCoop);
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  const apiDocConfig = configService.get<IApiDocConfig>('apiDoc');
  const securityWebConfig = configService.get<ISecurityWebConfig>('security.web');
  const baseConfig = configService.get<IBaseConfig>('base');

  // req.ip must resolve the real client IP from X-Forwarded-For (audit logs,
  // per-IP rate limiting); see parseTrustProxy for the BACKEND_TRUST_PROXY contract.
  if (securityWebConfig) {
    app.getHttpAdapter().getInstance().set('trust proxy', securityWebConfig.trustProxy);
  }
  if (!apiDocConfig?.disabled) {
    await setupSwagger(app, baseConfig?.publicOrigin ?? '', apiDocConfig?.enabledSnippet ?? false);
  }

  if (securityWebConfig?.cors.enabled) {
    // Public token-API CORS (GitHub-style): any origin may call with a bearer
    // token, which the browser never attaches automatically, so a cross-origin
    // page cannot ride a victim's credentials. Session/cookie endpoints stay
    // protected because credentials are never allowed — the browser blocks
    // cross-origin credentialed reads when Allow-Origin is `*` without
    // Allow-Credentials. Do NOT enable credentials here without also pinning
    // `origin` to an explicit allowlist.
    app.enableCors({ origin: '*', credentials: false });
  }
}

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    ...nestModuleIdOptions,
    ...nestRouteDiagnosticsOptions,
  });
  const configService = app.get(ConfigService);

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();

  app.enableShutdownHooks();

  await setUpAppMiddleware(app, configService);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  // app.getHttpServer().on('upgrade', async function (req: any, socket: any, head: any) {
  //   if (req.url.startsWith('/_next')) {
  //     console.log('upgrade: ', req.url);
  //     const server = app.get(NextService).server;
  //     return server.getUpgradeHandler()(req, socket, head);
  //   }
  // });

  const port = await getAvailablePort(configService.get<string>('PORT') as string);
  process.env.PORT = port.toString();

  await app.listen(port);

  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  logger.log(`> NODE_ENV is ${process.env.NODE_ENV}`);
  logger.log(`> Ready on http://${host}:${port}`);
  logger.log(`> System Time Zone: ${timeZone}`);
  logger.log(`> Current System Time: ${now.toString()}`);

  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    // DomainError is intentionally a POJO (Result-based, not thrown). If one
    // still escapes as an unhandled rejection, wrap it so Sentry gets a real
    // stack-bearing Error instead of collapsing into activeSpanWrapper.
    const normalized = isDomainError(reason) ? toError(reason) : reason;
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${normalized}`);
    throw normalized;
  });

  process.on('uncaughtException', (error) => {
    logger.error(error);
  });
  return app;
}

async function getAvailablePort(dPort: number | string): Promise<number> {
  let port = Number(dPort);
  while (await isPortReachable(port, { host })) {
    console.log(`> Fail on http://${host}:${port} Trying on ${port + 1}`);
    port++;
  }
  return port;
}
