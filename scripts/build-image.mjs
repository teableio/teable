#!/usr/bin/env zx
/**
 * Generates a version string following the Semantic Versioning (SemVer) specification, with added build metadata.
 *
 * The basic version number follows the format: major.minor.patch (e.g., 1.0.0)
 *
 * If not in a GitHub Actions environment:
 * - By default, the generated version number format is: {base version}-alpha
 *   For example, if the version in package.json is 1.0.0, the generated version number would be 1.0.0-alpha
 *
 * If in a GitHub Actions environment:
 * - For branch references, the generated version number format is: {base version}-alpha+build.{GITHUB_RUN_NUMBER}.sha-{first 7 characters of GITHUB_SHA}
 *   For example, for version 1.0.0 on the 123rd run in GitHub Actions with a commit SHA of abcdefg, the generated version number would be 1.0.0-alpha+build.123.sha-abcdefg
 *
 * - For tag references, the generated version number format is: {base version}+build.{GITHUB_RUN_NUMBER}.sha-{first 7 characters of GITHUB_SHA}
 *   For example, for version 1.0.0 on the 123rd run in GitHub Actions with a commit SHA of abcdefg, the generated version number would be 1.0.0+build.123.sha-abcdefg
 *
 * The generated version number is ultimately written to the .env file in the specified Next.js project directory, as the environment variable NEXT_PUBLIC_BUILD_VERSION.
 */

const env = $.env;
let isCi = ['true', '1'].includes(env?.CI ?? '');

const getSemver = async () => {
  // console.log('all environment variables: ', env);

  const nextjsDir = env.NEXTJS_DIR ?? 'apps/nextjs-app';
  const { version } = await fs.readJson(`${nextjsDir}/package.json`);
  let semver = `${version}-alpha`;

  if (env.GITHUB_ACTIONS) {
    // github action
    isCi = true;
    const refType = env.GITHUB_REF_TYPE;
    const runNumber = env.GITHUB_RUN_NUMBER;
    const isPR = Boolean(env.GITHUB_HEAD_REF);
    
    console.log('isPR:', isPR);
    console.log('refType: ', refType);
    console.log('runNumber: ', runNumber);

    switch (refType) {
      case 'branch':
        semver = isPR
          ? `${version}-alpha+pr-build.${runNumber}`
          : `${version}-alpha+build.${runNumber}`;
        break;
      case 'tag':
        semver = `${version}+build.${runNumber}`;
        break;
    }
  }
  console.log('semver: ', semver);
  return semver;
};

const toArray = (input, commaSplit = false, newlineSplit = false) => {
  if (input === undefined) return [];

  const delimiter = commaSplit ? ',' : newlineSplit ? '\n' : null;

  const items = Array.isArray(input) ? input : [input];

  return items.flatMap((item) => {
    if (typeof item === 'string' && delimiter) {
      return item.split(delimiter).map((part) => part.trim());
    } else if (typeof item === 'string') {
      return item.trim();
    }
    return item;
  });
};
const toBoolean = (input) => Boolean(input);
const asyncForEach = async (array, callback) => {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
};

const {
  file = 'Dockerfile',
  'build-arg': buildArg,
  'cache-from': cacheFromArg,
  'cache-to': cacheToArg,
  tag,
  'tag-suffix': tagSuffix,
  platform: platformArg,
  push: pushArg,
} = argv;

const buildArgs = toArray(buildArg);
const cacheFrom = toArray(cacheFromArg);
const cacheTo = toArray(cacheToArg);
const tags = toArray(tag, false, true);
const platform = platformArg ?? '';
const push = toBoolean(pushArg);
const remotes = Array.from(new Set(tags.map((tag) => tag.split(':')[0])));

const command = ['docker', 'build'];

// BUILD_VERSION - this is a default behavior
const semver = await getSemver();
const dockerSemver = semver.replace(/\+/g, '-').replace(/\s/g, '_');
command.push('--build-arg', `BUILD_VERSION=${semver}`);

await asyncForEach(buildArgs, async (buildArg) => {
  command.push('--build-arg', buildArg);
});
await asyncForEach(cacheFrom, async (cacheFrom) => {
  command.push('--cache-from', cacheFrom);
});
await asyncForEach(cacheTo, async (cacheTo) => {
  command.push('--cache-to', cacheTo);
});
if (file) {
  command.push('--file', file);
}
if (platform) {
  command.push('--platform', platform);
}

const arch = platform.split('/')[1];

remotes.forEach((remote) => {
  command.push('--tag', `${remote}:${dockerSemver}-${arch}`);
});

tags.forEach((tag) => {
  command.push('--tag', `${tag}-${arch}${tagSuffix ?? ''}`);
});

if (push) {
  command.push('--push');
}

command.push('.');

console.log('command: ', command.join(' '));
await $`${command}`;
