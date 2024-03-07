#!/usr/bin/env zx

const env = $.env;

console.log('all environment variables: ', env);

const nextjsDir = env.NEXTJS_DIR ?? 'apps/nextjs-app';
const envPath = `${nextjsDir}/.env`;
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

$`echo "NEXT_PUBLIC_BUILD_VERSION=${semver}" >> ${envPath}`;
