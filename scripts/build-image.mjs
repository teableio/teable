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
    const sha = env.GITHUB_SHA.substring(0, 7);

    console.log('refType: ', refType);
    console.log('runNumber: ', runNumber);
    console.log('sha: ', sha);

    switch (refType) {
      case 'branch':
        semver = `${version}-alpha+build.${runNumber}.sha-${sha}`;
        break;
      case 'tag':
        semver = `${version}+build.${runNumber}.sha-${sha}`;
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
  platforms: platformsArg,
  push: pushArg,
} = argv;

const buildArgs = toArray(buildArg);
const cacheFrom = toArray(cacheFromArg);
const cacheTo = toArray(cacheToArg);
const tags = toArray(tag, false, true);
const platforms = toArray(platformsArg, true);
const push = toBoolean(pushArg);

const command = ['docker', 'buildx', 'build'];

// BUILD_VERSION - this is a default behavior
const semver = await getSemver();
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
if (platforms.length > 0) {
  command.push('--platform', platforms.join(','));
}
await asyncForEach(tags, async (fullName) => {
  const [image, tag] = fullName.split(':');
  command.push('--tag', `${image}:${tag}${tagSuffix ?? ''}`);
  command.push('--tag', `${image}:${semver}`);
});

if (push) {
  command.push('--push');
}

command.push('.');
command.push('--progress=plain');

await $`${command}`;
