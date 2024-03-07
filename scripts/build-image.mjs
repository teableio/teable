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

const getSemver = async () => {
  console.log('all environment variables: ', env);

  const nextjsDir = env.NEXTJS_DIR ?? 'apps/nextjs-app';
  const { version } = await fs.readJson(`${nextjsDir}/package.json`);
  let semver = `${version}-alpha`;

  if (env.GITHUB_ACTIONS) {
    // github action
    const refType = env.GITHUB_REF_TYPE;
    const runNumber = env.GITHUB_RUN_NUMBER;
    const sha = env.GITHUB_SHA.substring(0, 7);

    switch (refType) {
      case 'branch':
        semver = `${version}-alpha+build.${runNumber}.sha-${sha}`;
        break;
      case 'tag':
        semver = `${version}+build.${runNumber}.sha-${sha}`;
        break;
    }
  }

  return semver;
};

const toArray = (input, commaSplit = false) => {
  if (input === undefined) {
    return [];
  }
  if (typeof input === 'string' && !commaSplit) {
    return input.split(',').map((item) => item.trim());
  }
  if (Array.isArray(input)) {
    return input.map((item) => (typeof item === 'string' ? item.trim() : item));
  }
  return [input];
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
  platforms: platformsArg,
  push: pushArg,
} = argv;

const buildArgs = toArray(buildArg);
const cacheFrom = toArray(cacheFromArg);
const cacheTo = toArray(cacheToArg);
const tags = toArray(tag);
const platforms = toArray(platformsArg, true);
const push = toBoolean(pushArg);

const command = ['docker', 'buildx', 'build'];

// BUILD_VERSION - this is a default behavior
command.push('--build-arg', `BUILD_VERSION=${await getSemver()}`);

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
if (platforms.length > 0) {
  command.push('--platform', platforms.join(','));
}
await asyncForEach(tags, async (tag) => {
  command.push('--tag', tag);
});

if (push) {
  command.push('--push');
}

command.push('.');

console.log(command.join(' '));
await $`${command}`;
