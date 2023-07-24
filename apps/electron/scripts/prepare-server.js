const path = require('path');
const { execSync } = require('child_process');
const { copySync, writeFileSync } = require('fs-extra');

const root = path.join(__dirname, '../../../');

// enter project directory
const serverOutput = 'apps/electron/server';

const packages = [
  {
    path: '',
    files: ['package.json', '.yarnrc.yml', '.yarn/releases', '.yarn/plugins', 'static'],
  },
  {
    path: 'apps/nestjs-backend',
    files: ['package.json', 'dist'],
  },
  {
    path: 'apps/nextjs-app',
    files: ['package.json', '.next', '.env', 'public'],
  },
  {
    path: 'packages/core',
    files: ['package.json', 'dist'],
  },
  {
    path: 'packages/db-main-prisma',
    files: ['package.json', 'dist', 'prisma', '.env'],
  },
  {
    path: 'packages/icons',
    files: ['package.json', 'dist'],
  },
  {
    path: 'packages/openapi',
    files: ['package.json', 'dist'],
  },
  {
    path: 'packages/sdk',
    files: ['package.json', 'dist'],
  },
  {
    path: 'packages/ui-lib',
    files: ['package.json', 'dist'],
  },
  {
    path: 'packages/common-i18n',
    files: ['package.json', 'src'],
  },
];

function copyPackages() {
  packages.forEach((pkg) => {
    console.log('begin copy...', pkg.path);
    pkg.files.forEach((file) => {
      const src = path.join(root, `${pkg.path}/${file}`);
      const dest = path.join(root, `${serverOutput}/${pkg.path}/${file}`);
      copySync(src, dest);
    });
    console.log('completed ✅');
  });
  console.log('🎉 copy packages success!!!');
}

function fixPostinstall() {
  packages.forEach((pkg) => {
    const packageJsonPath = path.join(root, serverOutput, pkg.path, 'package.json');
    const packageJson = require(packageJsonPath);
    if (pkg.path.includes('db-main-prisma') || !packageJson?.scripts?.postinstall) {
      return;
    }
    delete packageJson.scripts.postinstall;

    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  });
}

copyPackages();
writeFileSync('server/yarn.lock', '');
fixPostinstall();

execSync('yarn workspaces focus --production --all', { cwd: 'server/', stdio: 'inherit' });
