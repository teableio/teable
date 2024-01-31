#!/usr/bin/env zx

/*
 * Script to clean up after a Docker build in a CI/CD environment.
 * It removes unnecessary artifacts and clears specific directories.
 */

async function deleteUnnecessaryFiles(dirPath, config) {
  const { keepDirList, keepFileList, dirsToDeleteEntirely } = config;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    const deletePromises = entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (dirsToDeleteEntirely.includes(entry.name)) {
          console.log(`Deleting entire directory: ${entryPath}`);
          await fs.promises.rm(entryPath, { recursive: true, force: true });
        } else if (!keepDirList.includes(entry.name)) {
          console.log(`Processing directory: ${entryPath}`);
          await deleteUnnecessaryFiles(entryPath, config);
        }
      } else if (entry.isFile() && !keepFileList.includes(entry.name)) {
        console.log(`Deleting file: ${entryPath}`);
        await fs.promises.rm(entryPath, { force: true });
      }
    });

    await Promise.all(deletePromises);
  } catch (error) {
    console.error(`Failed to delete in ${dirPath}: ${error.message}`);
    throw error; // Rethrow to handle it in the main try-catch block
  }
}

try {
  // Configurations and paths can be set via environment variables or arguments
  const rootDir = process.env.ROOT_DIR || '/app';
  const appsPath = `${rootDir}/apps`;
  const packagesPath = `${rootDir}/packages`;

  // Remove specific directories and node modules
  await $`rm -fr ${packagesPath}/eslint-config-bases ${packagesPath}/ui-lib`;
  console.log('Cleared specific directories and node modules.');

  // Delete the Next.js build cache
  await $`rm -fr ${appsPath}/nextjs-app/.next/cache`;
  console.log('Deleted Next.js build cache.');

  const config = {
    keepDirList: ['dist', 'node_modules', 'prisma'],
    keepFileList: [
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      '.env',
      'ecosystem.config.js',
    ],
    dirsToDeleteEntirely: ['src'],
  };

  await deleteUnnecessaryFiles(packagesPath, config);
  console.log('Cleanup completed.');
} catch (error) {
  console.error(`Cleanup script failed: ${error.message}`);
  process.exit(1);
}
