import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';
import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { SwaggerModule } from '@nestjs/swagger';
import { getOpenApiDocumentation } from '@teable/openapi';
import type { RedocOptions } from 'nestjs-redoc';
import { RedocModule } from 'nestjs-redoc';

export async function setupSwagger(
  app: INestApplication,
  publicOrigin: string,
  enabledSnippet: boolean
) {
  const openApiDocumentation = await getOpenApiDocumentation({
    origin: publicOrigin,
    snippet: enabledSnippet,
  });

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
