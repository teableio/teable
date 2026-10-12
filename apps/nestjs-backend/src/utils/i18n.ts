import fs from 'node:fs';
import path from 'node:path';

// ESM-style module resolution (NestJS 12 migration guide, "Moving your own code to ESM"):
// `import.meta.dirname` replaces `__dirname`. Inside the Rspack CommonJS bundle it is rewritten
// to the bundle's `__dirname`, so the dist-relative candidates below keep working; under vitest
// it is the source directory, where the node_modules candidate resolves.
const localPaths = [
  process.env.I18N_LOCALES_PATH || '',
  path.join(import.meta.dirname, '../../../community/packages/common-i18n/src/locales'),
  path.join(import.meta.dirname, '../../../packages/common-i18n/src/locales'),
  path.join(import.meta.dirname, '../../node_modules/@teable/common-i18n/src/locales'),
];

export const getI18nPath = () => {
  console.debug('backend I18n path checking', import.meta.dirname, 'localPaths', localPaths);
  return localPaths.filter(Boolean).find((str) => {
    const exists = fs.existsSync(str);
    console.debug(`backend I18n path checking exists ${exists} ${str} `);
    if (exists) {
      console.debug('backend I18n path found', str);
    }
    return exists;
  });
};

export const getI18nTypesOutputPath = () => {
  const path = process.env.I18N_TYPES_OUTPUT_PATH;
  console.debug('backend I18n types output path:', path);
  if (!path) {
    return undefined;
  }
  return path;
};
