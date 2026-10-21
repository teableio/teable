import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { SwaggerModule } from '@nestjs/swagger';
import { generateCodeSamples, getOpenApiDocumentation } from '@teable/openapi';
import type { Request, Response } from 'express';
import { escape } from 'lodash';
import { annotateAppOpenApiTokenAccess } from './features/auth/openapi-token-access';

// Redoc 3's standalone bundle is an ES module without the `Redoc` global and drops
// sortPropsAlphabetically / noAutoAuth, so the page stays on 2.x.
const REDOC_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/redoc@2.5.4/bundles/redoc.standalone.js';
const REDOC_SCRIPT_INTEGRITY =
  'sha384-w447zOpYfw/1Tv/5AK9NfHTlQIqE3RVR6KY62jCyy9zNDgO64cMwGGP1Fj0zJVf5';
const REDOC_SPEC_PATH = '/redocs/swagger.json';

const buildRedocCsp = (nonce: string): string =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "font-src 'self' data: https:",
    "style-src 'self' https: 'unsafe-inline'",
    "connect-src 'self'",
    `script-src 'nonce-${nonce}'`,
    'worker-src blob:',
  ].join('; ');

const buildRedocHtml = (title: string, nonce: string): string => `<!DOCTYPE html>
<html>
  <head>
    <title>${escape(title)}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet" />
    <style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <div id="redoc_container"></div>
    <script nonce="${nonce}" src="${REDOC_SCRIPT_URL}" integrity="${REDOC_SCRIPT_INTEGRITY}" crossorigin="anonymous"></script>
    <script nonce="${nonce}">
      Redoc.init(
        '${REDOC_SPEC_PATH}',
        { requiredPropsFirst: true, sortPropsAlphabetically: true, noAutoAuth: true },
        document.getElementById('redoc_container')
      );
    </script>
  </body>
</html>
`;

export function setupRedoc(app: INestApplication, document: OpenAPIObject) {
  const documentJson = JSON.stringify(document);
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/redocs', (_req: Request, res: Response) => {
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Security-Policy', buildRedocCsp(nonce));
    res.type('html').send(buildRedocHtml(document.info.title, nonce));
  });
  httpAdapter.get(REDOC_SPEC_PATH, (_req: Request, res: Response) => {
    res.type('json').send(documentJson);
  });
}

export async function setupSwagger(
  app: INestApplication,
  publicOrigin: string,
  enabledSnippet: boolean
) {
  const openApiDocumentation = await getOpenApiDocumentation({
    origin: publicOrigin,
    snippet: false,
  });

  // Mark every operation with how it authenticates (bearer token with scopes,
  // session cookie only + x-excluded, or public) so one document serves the
  // frontend type generation, /docs and the public docs site alike.
  const stats = annotateAppOpenApiTokenAccess(app, openApiDocumentation as OpenAPIObject);
  const logger = new Logger('OpenApiDocs');
  logger.log(
    `OpenAPI auth annotation: token ${stats.token}, cookie-only ${stats.cookieOnly}, public ${stats.public}, unmatched ${stats.unmatched.length}`
  );
  if (stats.unmatched.length) {
    logger.debug(`OpenAPI routes without a serving controller: ${stats.unmatched.join(', ')}`);
  }

  // Code samples take their auth header from each operation's `security`, so
  // they must be generated after the annotation above — otherwise public and
  // session-only operations would show a bearer token they do not accept.
  if (enabledSnippet) {
    await generateCodeSamples(openApiDocumentation);
  }

  const jsonString = JSON.stringify(openApiDocumentation);
  fs.writeFileSync(path.join(__dirname, '/openapi.json'), jsonString);
  SwaggerModule.setup('/docs', app, openApiDocumentation as OpenAPIObject);
  setupRedoc(app, openApiDocumentation as OpenAPIObject);
}
