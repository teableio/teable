import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';
import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { SwaggerModule } from '@nestjs/swagger';
import { getOpenApiDocumentation } from '@teable/openapi';
import type { RedocOptions } from 'nestjs-redoc';
import { RedocModule } from 'nestjs-redoc';
import { annotateAppOpenApiTokenAccess } from './features/auth/openapi-token-access';

export async function setupSwagger(
  app: INestApplication,
  publicOrigin: string,
  enabledSnippet: boolean
) {
  const openApiDocumentation = await getOpenApiDocumentation({
    origin: publicOrigin,
    snippet: enabledSnippet,
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

  const jsonString = JSON.stringify(openApiDocumentation);
  fs.writeFileSync(path.join(__dirname, '/openapi.json'), jsonString);
  SwaggerModule.setup('/docs', app, openApiDocumentation as OpenAPIObject);

  // Instead of using SwaggerModule.setup() you call this module
  const redocOptions: RedocOptions = {
    logo: {
      backgroundColor: '#F0F0F0',
      altText: 'Teable logo',
    },
  };
  await RedocModule.setup('/redocs', app, openApiDocumentation as OpenAPIObject, redocOptions);
}
