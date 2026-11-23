/* eslint-disable @typescript-eslint/naming-convention */
import { randomBytes } from 'node:crypto';
import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateV2OpenApiDocument } from '@teable/v2-contract-http-openapi';
import { Request, Response } from 'express';
import type { IBaseConfig } from '../../configs/base.config';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import { Public } from '../auth/decorators/public.decorator';
import { resolveBoolean } from './v2-config-parsers';

const V2_BASE_PATH = 'api/v2';
const OPENAPI_SPEC_PATH = `/${V2_BASE_PATH}/openapi.json`;
const SCALAR_CDN_ORIGIN = 'https://cdn.jsdelivr.net';

const buildServerUrl = (baseConfig: IBaseConfig | undefined, req: Request): string | undefined => {
  const publicOrigin = baseConfig?.publicOrigin;
  if (publicOrigin) return publicOrigin;

  const host = req.get('host');
  if (!host) return undefined;

  return `${req.protocol}://${host}`;
};

const buildDocsCsp = (nonce: string): string =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "font-src 'self' data: https:",
    "style-src 'self' https: 'unsafe-inline'",
    "connect-src 'self'",
    `script-src 'self' ${SCALAR_CDN_ORIGIN} 'nonce-${nonce}'`,
    `script-src-elem 'self' ${SCALAR_CDN_ORIGIN} 'nonce-${nonce}'`,
    "script-src-attr 'none'",
  ].join('; ');

const buildScalarHtml = (specUrl: string, nonce: string): string => `<!doctype html>
<html>
  <head>
    <title>Teable v2 API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>

    <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script nonce="${nonce}">
      Scalar.createApiReference('#app', {
        url: '${specUrl}',
      });
    </script>
  </body>
</html>
`;

@Public()
@Controller(V2_BASE_PATH)
export class V2OpenApiController {
  constructor(private readonly configService: ConfigService) {}

  @Get('openapi.json')
  @Header('Content-Type', 'application/json')
  async openapi(@Req() req: Request) {
    const baseConfig = this.configService.get<IBaseConfig>('base');
    const serverUrl = buildServerUrl(baseConfig, req);

    const serverBaseUrl = serverUrl ? `${serverUrl.replace(/\/$/, '')}/${V2_BASE_PATH}` : undefined;

    const document = await generateV2OpenApiDocument({
      includeDataQuery:
        resolveBoolean(this.configService.get('V2_DATA_QUERY_ENABLED'), false) ||
        resolveBoolean(this.configService.get('V2_DATA_QUERY_EXECUTE_ENABLED'), false),
      servers: serverBaseUrl ? [{ url: serverBaseUrl }] : undefined,
    });
    document.components = {
      ...document.components,
      securitySchemes: {
        ...document.components?.securitySchemes,
        memberToken: { type: 'http', scheme: 'bearer', description: 'Personal access token or OAuth access token; current collaborator rights and token resource/scopes both apply.' },
        memberSession: { type: 'apiKey', in: 'cookie', name: AUTH_SESSION_COOKIE_NAME, description: 'Authenticated member session. Share credentials are accepted only by share procedures.' },
      },
    };
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      if (!item) continue;
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const operation = item[method];
        if (operation) operation.security = path.startsWith('/share/') ? [] : [{ memberToken: [] }, { memberSession: [] }];
      }
    }
    return document;
  }

  @Get('docs')
  @Header('Content-Type', 'text/html; charset=utf-8')
  docs(@Res({ passthrough: true }) res: Response) {
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Security-Policy', buildDocsCsp(nonce));
    return buildScalarHtml(OPENAPI_SPEC_PATH, nonce);
  }
}
