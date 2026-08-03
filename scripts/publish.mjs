import { exec, execSync } from 'child_process';

const packages = [
  '@teable/sdk',
  '@teable/ui-lib',
  '@teable/openapi',
  '@teable/core',
  '@teable/common-i18n',
  '@teable/icons',
];
const npmToken = process.env.NPM_TOKEN;

const versionType = process.argv[2] || 'patch';
const tag = process.argv[3] || 'beta';

const buildCommand = `pnpm -r -F ${packages.join(' -F ')} build`;
const publishCommand = `echo "//registry.npmjs.org/:_authToken=${npmToken}" > ~/.npmrc && pnpm -r -F ${packages.join(' -F ')} publish --tag ${tag} --no-git-checks`;
const versionCommand = `pnpm version ${versionType} --preid=${tag} -ws --include-workspace-root --no-git-tag-version --json --no-workspaces-update`;

// run version update
execSync(versionCommand, { stdio: 'inherit' });
// run build
execSync(buildCommand, { stdio: 'inherit' });
// run publish
execSync(publishCommand, { stdio: 'inherit' });

// commit version update
const result = execSync('pnpm version --json', { encoding: 'utf-8' });

execSync('git add .', { stdio: 'inherit' });

execSync(
  `git commit -m "chore: publish ${JSON.parse(result)['@teable/teable']} release" --no-verify`,
  { stdio: 'inherit' }
);
