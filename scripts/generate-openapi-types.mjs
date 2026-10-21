import openapiTS, { astToString } from 'openapi-typescript';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

async function generateTypes() {
  const localPath = path.resolve(process.cwd(), 'apps/nestjs-backend/dist/openapi.json');
  const ast = await openapiTS(pathToFileURL(localPath), { defaultNonNullable: false });
  const output =
    [
      '/* eslint-disable sonarjs/no-duplicate-string */',
      '/* eslint-disable @typescript-eslint/naming-convention */',
      '/* eslint-disable prettier/prettier */',
    ].join('\n') +
    '\n' +
    astToString(ast);

  const outputPath = path.resolve(process.cwd(), 'apps/nextjs-app/src/api/types.ts');
  const outputDir = path.dirname(outputPath);

  // mkdir if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, output);

  console.log('Types generated and saved successfully.');
}

generateTypes();
