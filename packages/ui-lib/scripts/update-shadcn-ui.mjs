import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const componentsDir = join(process.cwd(), 'src/shadcn/ui');
const updateComName = process.argv[2];
const components = readdirSync(componentsDir, { withFileTypes: true })
  .filter(
    (dirent) =>
      !dirent.isDirectory() &&
      dirent.name.endsWith('.tsx') &&
      (!updateComName || dirent.name === `${updateComName}.tsx`)
  )
  .map((dirent) => dirent.name.split('.')[0]);

const updateCommand = 'pnpm shadcn:ui add';
components.forEach((component) => {
  const command = `${updateCommand} ${component} -o -y`;
  execSync(command, { stdio: 'inherit', cwd: process.cwd() });
});

execSync(
  `pnpm eslint --ext .ts,.tsx --fix --rule 'typescript-eslint/naming-convention: off' ${componentsDir}`,
  { stdio: 'inherit' }
);
