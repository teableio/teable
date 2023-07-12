const fs = require('fs');
const path = require('path');
const shadcnConfig = require('../components.json');
const { execSync } = require('child_process');

function fixAliases() {
  const folderPath = path.join(__dirname, '../src', shadcnConfig.aliases.components, 'ui');

  fs.readdirSync(folderPath).forEach((file) => {
    const filePath = path.join(folderPath, file);

    if (fs.lstatSync(filePath).isDirectory()) {
      return;
    }

    let content = fs.readFileSync(filePath, 'utf-8');

    // Replace utils path
    const replaceUtilsPath = path.join('../utils');
    content = content.replaceAll(shadcnConfig.aliases.utils, replaceUtilsPath);

    // Replace components path
    content = content.replaceAll(`${shadcnConfig.aliases.components}/ui/`, './');

    fs.writeFileSync(filePath, content, 'utf-8');

    execSync(`yarn eslint ${filePath} --fix`, { stdio: 'inherit' });

    console.log('Fixed.');
  });
}

const args = process.argv.slice(2).join(' ');

execSync(`yarn shadcn-ui ${args}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });

if (process.argv[2] === 'add') {
  fixAliases();
}
