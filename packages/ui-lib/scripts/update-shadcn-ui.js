const { execSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');
const componentsDir = path.join(__dirname, '../src/shadcn/ui');

const components = readdirSync(componentsDir, { withFileTypes: true })
  .filter((dirent) => !dirent.isDirectory() && dirent.name.endsWith('.tsx'))
  .map((dirent) => dirent.name.split('.')[0]);

const updateCommand = 'pnpm shadcn-ui add';
components.forEach((component) => {
  const command = `${updateCommand} ${component} -o -y`;
  execSync(command, { stdio: 'inherit' });
});

execSync(
  `pnpm eslint --ext .ts,.tsx --fix --rule 'typescript-eslint/naming-convention: off' ${componentsDir}`,
  { stdio: 'inherit' }
);
