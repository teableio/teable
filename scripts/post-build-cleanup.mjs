#!/usr/bin/env zx

/*
 * Script to clean up after a Docker build in a CI/CD environment.
 * It removes unnecessary artifacts and clears specific directories.
 */

async function deleteUnnecessaryFiles(dirPath, config, parentDirName = null) {
  const {
    keepDirList,
    keepFileList,
    dirsToDeleteEntirely,
    skipDeleteSrcIn = [],
    skipDeleteScriptsIn = [],
  } = config;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    const deletePromises = entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip deleting src directory for specified packages (keep entire src)
        const shouldSkipSrcDelete = entry.name === 'src' && skipDeleteSrcIn.includes(parentDirName);
        const shouldSkipScriptsDelete =
          entry.name === 'scripts' && skipDeleteScriptsIn.includes(parentDirName);

        if (shouldSkipSrcDelete) {
          console.log(`Skipping src directory for ${parentDirName}: ${entryPath}`);
          // Do nothing - keep entire src directory intact
        } else if (shouldSkipScriptsDelete) {
          console.log(`Skipping scripts directory for ${parentDirName}: ${entryPath}`);
        } else if (dirsToDeleteEntirely.includes(entry.name)) {
          console.log(`Deleting entire directory: ${entryPath}`);
          await fs.promises.rm(entryPath, { recursive: true, force: true });
        } else if (!keepDirList.includes(entry.name)) {
          console.log(`Processing directory: ${entryPath}`);
          await deleteUnnecessaryFiles(entryPath, config, entry.name);
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
  await $`rm -fr ${packagesPath}/eslint-config-bases`;
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
    // Packages that should keep their src directory
    skipDeleteSrcIn: ['common-i18n'],
    // Prisma package scripts are needed by image build client generation and runtime migrations.
    skipDeleteScriptsIn: ['db-main-prisma', 'db-data-prisma'],
  };

  await deleteUnnecessaryFiles(packagesPath, config);
  console.log('Cleanup completed.');
} catch (error) {
  console.error(`Cleanup script failed: ${error.message}`);
  process.exit(1);
}
