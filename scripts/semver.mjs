#!/usr/bin/env zx

const env = $.env;

const nextjsDir = env.NEXTJS_DIR ?? 'apps/nextjs-app';
const envPath = `${nextjsDir}/.env`;
const { version } = await fs.readJson(`${nextjsDir}/package.json`);
let semver = `${version}-develop`;

if (env.GITHUB_ACTIONS) {
  // github action
  const runNumber = env.GITHUB_RUN_NUMBER;
  const sha = env.GITHUB_SHA.substring(0, 7);

  switch (env.GITHUB_REF_TYPE) {
    case 'branch':
      semver = `${version}-alpha+build.${runNumber}.sha-${sha}`;
      break;
    case 'tag':
      semver = `${version}+build.${runNumber}.sha-${sha}`;
      break;
  }
}

$`echo "NEXT_PUBLIC_BUILD_VERSION=${semver}" >> ${envPath}`;
