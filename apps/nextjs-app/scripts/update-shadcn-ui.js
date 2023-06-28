const { execSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');
const componentsDir = path.join(__dirname, '../src/components/ui');

const components = readdirSync(componentsDir, { withFileTypes: true })
  .filter((dirent) => !dirent.isDirectory() && dirent.name.endsWith('.tsx'))
  .map((dirent) => dirent.name.split('.')[0]);

const updateCommand = 'yarn shadcn-ui add';
components.forEach((component) => {
  const command = `${updateCommand} ${component} -o -y`;
  execSync(command, { stdio: 'inherit' });
});

execSync(
  `yarn eslint --ext .ts,.tsx --fix --rule 'typescript-eslint/naming-convention: off' ${componentsDir}`,
  { stdio: 'inherit' }
);
