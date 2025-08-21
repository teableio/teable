#!/usr/bin/env zx
const env = $.env;
const nextjsDir = env.NEXTJS_DIR ?? 'apps/nextjs-app';
const staticDir = `${nextjsDir}/.next/static`;
const mcPath = '~/minio-binaries/mc';

// [[name, endpoint, accessKey, secretKey, bucket]]
const { list } = argv;
let parsedList = [];
if (list && typeof list === 'string' && list.trim() !== '') {
  try {
    parsedList = JSON.parse(list.trim());
  } catch (error) {
    console.warn('Warning: Failed to parse list JSON:', error.message);
    console.log('Skipping upload due to invalid configuration...');
    process.exit(0);
  }
}

if (!Array.isArray(parsedList)) {
  console.warn('Warning: list must be a array, but got:', typeof parsedList);
  console.log('Skipping upload due to invalid configuration...');
  process.exit(0);
}

if (parsedList.length === 0) {
  console.log('No upload assets list provided, skipping upload...');
  process.exit(0);
}

const checkPlatform = async () => {
  const platform = await $`uname -m`;
  const os = await $`uname -s`;
  console.log('checkPlatform: platform: ', platform.stdout);
  console.log('checkPlatform: os: ', os.stdout);
  if (platform.stdout.includes('arm64')) {
    return 'linux-arm64';
  }
  return 'linux-amd64';
};

const installMinioCli = async () => {
  const curlVersion = await $`curl -V`;
  console.log('curl version: ', curlVersion.stdout);

  const platform = await checkPlatform();
  console.log('Installing MinIO CLI: ', platform);
  await $`curl --progress-bar -L https://dl.min.io/client/mc/release/${platform}/mc \
  --create-dirs \
  -o ${mcPath}`;

  const chmod = await $`chmod +x ${mcPath}`;
  console.log('chmod: ', chmod.stdout);

  console.log('Testing mc --version');
  const version = await $`${mcPath} --version`;
  console.log('version: ', version.stdout);
};
await installMinioCli();

const setupMinioCli = async (list) => {
  for (const [name, endpoint, accessKey, secretKey] of list) {
    console.log(`Setting up MinIO alias for ${name}...`);
    const alias = await $`${mcPath} alias set ${name} ${endpoint} ${accessKey} ${secretKey}`;
    console.log('alias: ', alias.stdout);
  }
};
await setupMinioCli(parsedList);

const tempSyncStaticDir = async () => {
  const rsync = await $`rsync -av --exclude={'*.js.map','*.css.map'} ${staticDir} ~/temp/`;
  console.log('rsync: ', rsync.stdout);
};
await tempSyncStaticDir();

const syncStaticDir = async (list) => {
  for (const [name, _, __, ___, bucket] of list) {
    const cp = await $`${mcPath} cp --recursive ~/temp/static ${name}/${bucket}/_next/`;
    console.log('cp: ', cp.stdout);
  }
};

await syncStaticDir(parsedList);
