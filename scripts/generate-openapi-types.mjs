import openapiTS from 'openapi-typescript';
import path from 'path';
import fs from 'fs';

async function generateTypes() {
  const localPath = path.resolve(process.cwd(), 'apps/nestjs-backend/dist/openapi.json');
  const output = await openapiTS(localPath, {
    commentHeader:
      [
        '/* eslint-disable sonarjs/no-duplicate-string */',
        '/* eslint-disable @typescript-eslint/naming-convention */',
        '/* eslint-disable prettier/prettier */',
      ].join('\n') + '\n',
  });

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
