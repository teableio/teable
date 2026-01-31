#!/usr/bin/env zx
/**
 * Docker image builder with multi-registry parallel push support.
 *
 * Push Strategy:
 *   ┌─ Registry A: tag1 → tag2 → tag3 (serial)
 *   ├─ Registry B: tag1 → tag2 → tag3 (serial)  ← Parallel
 *   └─ Registry C: tag1 → tag2 → tag3 (serial)
 *
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
 * Usage:
 *   # Mode 1: Full registry tags (auto-detected, recommended for CI with docker/metadata-action)
 *   zx build-image.mjs \
 *     --file=Dockerfile \
 *     --tag="ghcr.io/org/image:v1.0.0
 *            registry.cn-xxx.aliyuncs.com/org/image:v1.0.0" \
 *     --platform=linux/amd64 --push
 *
 *   # Mode 2: Legacy (direct buildx push)
 *   zx build-image.mjs \
 *     --file=Dockerfile --tag=v1.0.0 \
 *     --platform=linux/amd64 --push
 *
 * Options:
 *   --file             Dockerfile path (default: Dockerfile)
 *   --tag              Image tags (full paths or simple tags, newline-separated)
 *   --platform         Target platform (e.g., linux/amd64)
 *   --push             Push images after build
 *   --build-arg        Build arguments (can repeat)
 *   --cache-from       Cache sources (can repeat)
 *   --cache-to         Cache destinations (can repeat)
 *   --tag-suffix       Suffix to append to tags
 *   --push-retry       Max retry attempts (default: 3)
 *   --push-retry-delay Retry delay in seconds (default: 5)
 *   --dry-run          Show commands without executing
 *   --upload-assets-list  Assets list for upload
 */

import { setTimeout as sleep } from 'node:timers/promises';

// ═══════════════════════════════════════════════════════════════════════════
// Tag Parsing & Grouping
// ═══════════════════════════════════════════════════════════════════════════

/** Check if tag is a full registry path (e.g., ghcr.io/org/image:tag) */
function isFullRegistryTag(tag) {
  if (!tag.includes('/')) return false;
  const registry = tag.split('/')[0];
  return registry.includes('.') || registry.includes(':');
}

/** Extract image path without tag: ghcr.io/org/image:v1 → ghcr.io/org/image */
function extractRegistryImage(fullTag) {
  const colonIdx = fullTag.lastIndexOf(':');
  const slashIdx = fullTag.lastIndexOf('/');
  return colonIdx > slashIdx ? fullTag.substring(0, colonIdx) : fullTag;
}

/** Group full registry tags by image path for parallel push */
function buildPushGroupsFromFullTags(tags, { arch, tagSuffix }) {
  const groupMap = new Map();

  tags.forEach((tag) => {
    let fullTag = tag;
    if (arch && !tag.endsWith(`-${arch}`) && !tag.endsWith(`-${arch}${tagSuffix ?? ''}`)) {
      fullTag = tagSuffix ? `${tag}-${arch}${tagSuffix}` : `${tag}-${arch}`;
    }

    const registryImage = extractRegistryImage(fullTag);
    if (!groupMap.has(registryImage)) {
      groupMap.set(registryImage, []);
    }
    groupMap.get(registryImage).push(fullTag);
  });

  return Array.from(groupMap.entries()).map(([registry, images]) => ({ registry, images }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const toArray = (input, commaSplit = false, newlineSplit = false) => {
  if (input === undefined) return [];
  const delimiter = commaSplit ? ',' : newlineSplit ? '\n' : null;
  const items = Array.isArray(input) ? input : [input];
  return items.flatMap((item) => {
    if (typeof item === 'string' && delimiter) {
      return item.split(delimiter).map((part) => part.trim());
    }
    return typeof item === 'string' ? item.trim() : item;
  });
};

const toBoolean = (input) => Boolean(input);

// ═══════════════════════════════════════════════════════════════════════════
// Version
// ═══════════════════════════════════════════════════════════════════════════

const env = $.env;
let isCi = ['true', '1'].includes(env?.CI ?? '');

/** Generate semver from package.json version and GitHub Actions context */
const getSemver = async () => {
  const nextjsDir = env.NEXTJS_DIR ?? 'apps/nextjs-app';
  const { version } = await fs.readJson(`${nextjsDir}/package.json`);
  let semver = `${version}-alpha`;

  if (env.GITHUB_ACTIONS) {
    isCi = true;
    const refType = env.GITHUB_REF_TYPE;
    const runNumber = env.GITHUB_RUN_NUMBER;
    const isPR = Boolean(env.GITHUB_HEAD_REF);

    console.log('GitHub Actions Context:');
    console.log('  isPR:', isPR);
    console.log('  refType:', refType);
    console.log('  runNumber:', runNumber);

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
  console.log('semver:', semver);
  return semver;
};

// ═══════════════════════════════════════════════════════════════════════════
// Push (with retry & grouped parallelism)
// ═══════════════════════════════════════════════════════════════════════════

/** Shared progress counter for parallel push operations */
class PushProgressTracker {
  constructor(total) {
    this.total = total;
    this.completed = 0;
  }

  increment() {
    return ++this.completed;
  }

  getProgress() {
    return `${this.completed}/${this.total}`;
  }
}

/**
 * Execute async function with exponential backoff retry
 * Delay formula: baseDelay * 2^(attempt-1) + jitter
 * Example with baseDelay=5s: 5s → 10s → 20s (+ random 0-1s jitter)
 */
async function withRetry(fn, { maxRetries = 3, delaySeconds = 5, onRetry }) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await fn();
      return { success: true, result, attempts: attempt };
    } catch (error) {
      lastError = error.message || String(error);
      if (attempt <= maxRetries) {
        // Exponential backoff with jitter
        const backoff = delaySeconds * Math.pow(2, attempt - 1);
        const jitter = Math.random(); // 0-1 second random jitter
        const waitTime = Math.round(backoff + jitter);
        if (onRetry) {
          onRetry({ attempt, maxRetries, waitTime, error: lastError });
        }
        await sleep(waitTime * 1000);
      }
    }
  }

  return { success: false, error: lastError, attempts: maxRetries + 1 };
}

/** Push single image with retry */
async function dockerPush(image, { maxRetries, delaySeconds, tracker }) {
  const tag = image.split(':').pop();
  const result = await withRetry(
    async () => {
      await $`docker push ${image}`;
    },
    {
      maxRetries,
      delaySeconds,
      onRetry: ({ attempt, maxRetries: max, waitTime }) => {
        console.log(
          chalk.yellow(`  ↻ Retry ${attempt}/${max} for ${tag}, waiting ${waitTime}s...`)
        );
      },
    }
  );

  // Log progress after each push completes
  tracker.increment();
  const status = result.success ? chalk.green('✓') : chalk.red('✗');
  const retryInfo = result.attempts > 1 ? chalk.yellow(` (retry ${result.attempts - 1}x)`) : '';
  console.log(
    chalk.gray(`[${tracker.getProgress()}]`) +
      ` ${status} ` +
      chalk.white(`docker push ${image}`) +
      retryInfo
  );

  return { ...result, image, tag };
}

/** Push all tags to one registry sequentially */
async function pushRegistryGroup(registry, images, { maxRetries, delaySeconds, tracker }) {
  const results = [];

  for (const image of images) {
    const result = await dockerPush(image, { maxRetries, delaySeconds, tracker });
    results.push(result);
  }

  return { registry, results };
}

/** Push to multiple registries: parallel across registries, serial within each */
async function pushGroupedByRegistry(groups, { maxRetries, delaySeconds, tracker }) {
  const promises = groups.map((g) =>
    pushRegistryGroup(g.registry, g.images, { maxRetries, delaySeconds, tracker })
  );
  return await Promise.all(promises);
}

/** Execute grouped push and print summary */
async function executeDockerPush(groups, { retry, retryDelay }) {
  const totalImages = groups.reduce((sum, g) => sum + g.images.length, 0);

  console.log();
  console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan('  Pushing Images to Docker Registries'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
  console.log();
  console.log(chalk.white('Target Registries:'));
  groups.forEach((g) => {
    console.log(chalk.gray(`  • ${g.registry} (${g.images.length} tags)`));
  });
  console.log();
  console.log(
    chalk.white(
      `Pushing ${totalImages} images to ${groups.length} registries (parallel by registry, serial by tag)...`
    )
  );
  console.log(chalk.gray(`Max retries per image: ${retry}`));
  console.log();

  const tracker = new PushProgressTracker(totalImages);
  const startTime = Date.now();

  const registryResults = await pushGroupedByRegistry(groups, {
    maxRetries: parseInt(retry, 10),
    delaySeconds: parseInt(retryDelay, 10),
    tracker,
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Flatten all results for counting
  const allResults = registryResults.flatMap((r) => r.results);
  const totalSuccessful = allResults.filter((r) => r.success).length;
  const totalFailed = allResults.filter((r) => !r.success).length;

  // Print detailed summary grouped by registry
  console.log();
  console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan('  Push Results by Registry'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════'));

  registryResults.forEach(({ registry, results }) => {
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const statusIcon = failed === 0 ? chalk.green('✓') : chalk.red('✗');

    console.log();
    console.log(`${statusIcon} ${chalk.white(registry)}`);
    results.forEach((r, idx) => {
      const isLast = idx === results.length - 1;
      const prefix = isLast ? '└─' : '├─';
      const icon = r.success ? chalk.green('✓') : chalk.red('✗');
      const retryInfo = r.attempts > 1 ? chalk.yellow(` (retry ${r.attempts - 1}x)`) : '';
      console.log(chalk.gray(`  ${prefix} `) + `${icon} ${r.tag}${retryInfo}`);
    });
    console.log(chalk.gray(`     ${successful}/${results.length} pushed`));
  });

  // Print final summary
  console.log();
  console.log(chalk.gray('─'.repeat(55)));
  console.log(
    chalk.white(`Total: ${allResults.length} images`) +
      chalk.gray(' | ') +
      chalk.green(`${totalSuccessful} ✓`) +
      chalk.gray(' | ') +
      chalk.red(`${totalFailed} ✗`) +
      chalk.gray(' | ') +
      chalk.white(`${duration}s`)
  );
  console.log(chalk.gray('─'.repeat(55)));

  if (totalFailed > 0) {
    console.log();
    console.log(chalk.red('Failed pushes:'));
    registryResults.forEach(({ registry, results }) => {
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.log(chalk.red(`  ✗ ${registry}:${r.tag}`));
          console.log(chalk.gray(`    Error: ${r.error}`));
        });
    });
    process.exit(1);
  }

  console.log();
  console.log(chalk.green('✓ All images pushed successfully!'));
}

// ═══════════════════════════════════════════════════════════════════════════
// Build Command
// ═══════════════════════════════════════════════════════════════════════════

/** Build docker buildx command with all tags */
function buildDockerCommand(options) {
  const {
    file,
    buildArgs,
    cacheFrom,
    cacheTo,
    platform,
    tags,
    tagSuffix,
    uploadAssetsList,
    semver,
    dockerSemver,
    arch,
    useFullRegistryTags,
  } = options;

  const command = ['docker', 'buildx', 'build'];
  command.push('--build-arg', `BUILD_VERSION=${semver}`);

  if (uploadAssetsList) {
    command.push('--build-arg', `UPLOAD_ASSETS_LIST=${uploadAssetsList}`);
  }

  buildArgs.forEach((arg) => command.push('--build-arg', arg));
  cacheFrom.forEach((cache) => command.push('--cache-from', cache));
  cacheTo.forEach((cache) => command.push('--cache-to', cache));

  if (file) command.push('--file', file);
  if (platform) command.push('--platform', platform);

  command.push('--provenance=false'); // Avoid extra attestation manifests

  // Mode 1: Full registry tags (recommended for CI)
  if (useFullRegistryTags) {
    tags.forEach((tag) => {
      let fullTag = tag;
      if (arch && !tag.endsWith(`-${arch}`) && !tag.endsWith(`-${arch}${tagSuffix ?? ''}`)) {
        fullTag = tagSuffix ? `${tag}-${arch}${tagSuffix}` : `${tag}-${arch}`;
      }
      command.push('--tag', fullTag);
    });

    // Also add semver tags for each unique registry
    const remotes = Array.from(new Set(tags.map((tag) => extractRegistryImage(tag))));
    remotes.forEach((remote) => {
      command.push('--tag', `${remote}:${dockerSemver}-${arch}`);
    });

    return command;
  }

  // Mode 2: Legacy - simple tags with arch suffix
  const remotes = Array.from(new Set(tags.map((tag) => tag.split(':')[0])));
  remotes.forEach((remote) => {
    command.push('--tag', `${remote}:${dockerSemver}-${arch}`);
  });

  tags.forEach((tag) => {
    command.push('--tag', `${tag}-${arch}${tagSuffix ?? ''}`);
  });

  return command;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dry-Run Output Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Print a labeled list or "(none)" if empty */
function printList(label, items) {
  console.log(chalk.yellow(`${label}:`));
  if (items.length > 0) {
    items.forEach((item) => console.log(chalk.gray('  -'), item));
  } else {
    console.log(chalk.gray('  (none)'));
  }
  console.log();
}

/** Print dry-run configuration summary */
function printDryRunConfig(config) {
  const {
    file,
    platform,
    arch,
    push,
    tagSuffix,
    semver,
    dockerSemver,
    buildArgs,
    cacheFrom,
    cacheTo,
    tags,
    useFullRegistryTags,
  } = config;

  console.log();
  console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan('  DRY-RUN MODE - No commands will be executed'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════'));
  console.log();

  console.log(chalk.yellow('Configuration:'));
  console.log(chalk.gray('  Dockerfile:'), file);
  console.log(chalk.gray('  Platform:'), platform || '(default)');
  console.log(chalk.gray('  Architecture:'), arch || '(default)');
  console.log(chalk.gray('  Push:'), push);
  console.log(chalk.gray('  Tag Suffix:'), tagSuffix || '(none)');
  console.log();

  console.log(chalk.yellow('Version Info:'));
  console.log(chalk.gray('  Semver:'), semver);
  console.log(chalk.gray('  Docker Semver:'), dockerSemver);
  console.log();

  printList('Build Args', buildArgs);
  printList('Cache From', cacheFrom);
  printList('Cache To', cacheTo);
  printList('Tags', tags);

  console.log(chalk.yellow('Mode:'));
  if (useFullRegistryTags) {
    console.log(chalk.gray('  Full Registry Tags (tags are complete registry paths)'));
  } else {
    console.log(chalk.gray('  Legacy (direct buildx push)'));
  }
  console.log();
}

/** Print dry-run push groups summary */
function printDryRunPushGroups(command, pushGroups, pushRetry, pushRetryDelay) {
  const totalImages = pushGroups.reduce((sum, g) => sum + g.images.length, 0);

  console.log(chalk.yellow('Docker Build Command:'));
  console.log(chalk.white('  ' + command.join(' ')));
  console.log();

  console.log(
    chalk.yellow(`Push Groups (${pushGroups.length} registries, ${totalImages} total images):`)
  );
  console.log(chalk.gray('  Strategy: registries in parallel, tags in serial'));
  console.log();
  pushGroups.forEach((group, gi) => {
    console.log(chalk.gray(`  [Registry ${gi + 1}] ${group.registry}`));
    group.images.forEach((image, ii) => {
      console.log(chalk.gray(`    [${ii + 1}] docker push ${image}`));
    });
  });
  console.log();

  console.log(chalk.yellow('Push Config:'));
  console.log(chalk.gray('  Max Retries:'), pushRetry);
  console.log(chalk.gray('  Retry Delay:'), pushRetryDelay + 's (exponential backoff)');
  console.log();

  console.log(chalk.green('✓ Dry-run complete. No commands were executed.'));
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Build & Push Execution
// ═══════════════════════════════════════════════════════════════════════════

/** Execute build command and optionally push images */
async function buildAndPush(command, pushGroups, { push, pushRetry, pushRetryDelay }) {
  console.log('command:', command.join(' '));
  await $`${command}`;

  if (!push) {
    console.log(chalk.yellow('Build complete. Skipping push (--push not set).'));
    process.exit(0);
  }

  await executeDockerPush(pushGroups, {
    retry: pushRetry,
    retryDelay: pushRetryDelay,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // Parse CLI arguments
  const {
    file = 'Dockerfile',
    'build-arg': buildArg,
    'cache-from': cacheFromArg,
    'cache-to': cacheToArg,
    tag,
    'tag-suffix': tagSuffix,
    platform: platformArg,
    push: pushArg,
    'upload-assets-list': uploadAssetsListArg,
    'push-retry': pushRetry = 3,
    'push-retry-delay': pushRetryDelay = 5,
    'dry-run': dryRunArg,
  } = argv;

  const dryRun = toBoolean(dryRunArg);
  const push = toBoolean(pushArg);
  const buildArgs = toArray(buildArg);
  const cacheFrom = toArray(cacheFromArg);
  const cacheTo = toArray(cacheToArg);
  const tags = toArray(tag, false, true);
  const platform = platformArg ?? '';
  const uploadAssetsList = uploadAssetsListArg ?? '';

  // Compute version info
  const semver = await getSemver();
  const dockerSemver = semver.replace(/\+/g, '-').replace(/\s/g, '_');
  const arch = platform.split('/')[1];
  const useFullRegistryTags = tags.length > 0 && tags.every((t) => isFullRegistryTag(t));

  // Build docker command
  const command = buildDockerCommand({
    file,
    buildArgs,
    cacheFrom,
    cacheTo,
    platform,
    tags,
    tagSuffix,
    uploadAssetsList,
    semver,
    dockerSemver,
    arch,
    useFullRegistryTags,
  });

  // Print dry-run config if needed
  if (dryRun) {
    printDryRunConfig({
      file,
      platform,
      arch,
      push,
      tagSuffix,
      semver,
      dockerSemver,
      buildArgs,
      cacheFrom,
      cacheTo,
      tags,
      useFullRegistryTags,
    });
  }

  // Mode 1: Full registry tags (recommended for CI)
  if (useFullRegistryTags) {
    command.push('--load', '.');
    const pushGroups = buildPushGroupsFromFullTags(tags, { arch, tagSuffix });

    // Add semver tags to push groups
    pushGroups.forEach((group) => {
      const semverTag = `${group.registry}:${dockerSemver}-${arch}`;
      if (!group.images.includes(semverTag)) {
        group.images.push(semverTag);
      }
    });

    if (dryRun) {
      printDryRunPushGroups(command, pushGroups, pushRetry, pushRetryDelay);
    }

    await buildAndPush(command, pushGroups, { push, pushRetry, pushRetryDelay });
    return;
  }

  // Mode 2: Direct buildx push (legacy fallback)
  command.push(push ? '--push' : '--load', '.');

  if (dryRun) {
    console.log(chalk.yellow('Docker Build Command (Legacy Mode):'));
    console.log(chalk.white('  ' + command.join(' ')));
    console.log();
    console.log(chalk.green('✓ Dry-run complete. No commands were executed.'));
    process.exit(0);
  }

  console.log('command:', command.join(' '));
  await $`${command}`;
}

// Run
main().catch((err) => {
  console.error(chalk.red('Build failed:'), err);
  process.exit(1);
});
