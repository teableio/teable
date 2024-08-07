import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'fs';
import { join } from 'path';
import data from '../components.json' assert { type: 'json' };

const { aliases } = data;

function fixAliases(componentName) {
  const fixFile = (filePath) => {
    let content = readFileSync(filePath, 'utf-8');

    // Replace utils path
    const replaceUtilsPath = join('../utils');
    content = content.replaceAll(aliases.utils, replaceUtilsPath);

    // Replace components path
    content = content.replaceAll(`${aliases.components}/ui/`, './');

    writeFileSync(filePath, content, 'utf-8');

    execSync(`pnpm eslint ${filePath} --fix`, { stdio: 'inherit' });

    console.log('Fixed.');
  };

  const folderPath = join(process.cwd(), aliases.components, 'ui');

  if (componentName) {
    const filePath = join(folderPath, `${componentName}.tsx`);
    fixFile(filePath);
    return;
  }

  readdirSync(folderPath).forEach((file) => {
    const filePath = join(folderPath, file);

    if (lstatSync(filePath).isDirectory()) {
      return;
    }
    fixFile(filePath);
  });
}

const args = process.argv.slice(2).join(' ');

execSync(`pnpm shadcn-ui ${args}`, { stdio: 'inherit', cwd: process.cwd() });

if (process.argv[2] === 'add') {
  fixAliases(process.argv[3]);
}
