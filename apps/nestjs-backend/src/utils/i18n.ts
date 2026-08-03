import fs from 'fs';
import path from 'path';

const localPaths = [
  process.env.I18N_LOCALES_PATH || '',
  path.join(__dirname, '../../../community/packages/common-i18n/src/locales'),
  path.join(__dirname, '../../../packages/common-i18n/src/locales'),
  path.join(__dirname, '../../node_modules/@teable/common-i18n/src/locales'),
];

export const getI18nPath = () => {
  console.debug('backend I18n path checking', __dirname, 'localPaths', localPaths);
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
