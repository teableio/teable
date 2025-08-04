#!/usr/bin/env -S pnpm zx

/**
 * Generated Column Performance Test Runner
 * This script helps run the performance tests with proper setup
 */

// @ts-check
import { $, chalk } from 'zx';

// Enable verbose mode for debugging
$.verbose = true;

console.log(chalk.blue('🚀 Starting Generated Column Performance Tests'));
console.log(chalk.blue('=============================================='));

// Check if PostgreSQL URL is set
if (!process.env.PRISMA_DATABASE_URL) {
  console.log(
    chalk.yellow('⚠️  Warning: PRISMA_DATABASE_URL not set. PostgreSQL tests will be skipped.')
  );
  console.log(chalk.gray('   To run PostgreSQL tests, set the environment variable:'));
  console.log(
    chalk.gray("   export PRISMA_DATABASE_URL='postgresql://user:password@localhost:5432/database'")
  );
  console.log('');
}

// Check available memory
console.log(chalk.cyan('💾 System Memory Info:'));
try {
  if (process.platform === 'darwin') {
    // macOS
    await $`vm_stat | head -5`;
  } else if (process.platform === 'linux') {
    // Linux
    await $`free -h`;
  } else {
    console.log(chalk.gray('   Memory info not available on this platform'));
  }
} catch (error) {
  console.log(chalk.gray('   Could not retrieve memory info'));
}
console.log('');

// Set Node.js memory limit for large datasets
process.env.NODE_OPTIONS = '--max-old-space-size=4096';

console.log(chalk.cyan('🔧 Node.js Configuration:'));
console.log(chalk.gray('   Memory limit: 4GB'));
try {
  const nodeVersion = await $`node --version`;
  console.log(chalk.gray(`   Node version: ${nodeVersion.stdout.trim()}`));
} catch (error) {
  console.log(chalk.gray('   Could not get Node version'));
}
console.log('');

console.log(chalk.cyan('📊 Running Performance Tests...'));
console.log(chalk.gray('   Test data: 50,000 records per database'));
console.log(chalk.gray('   Databases: PostgreSQL (if configured) + SQLite'));
console.log(chalk.gray('   Formulas: Simple addition, multiplication, complex'));
console.log('');

// Run the benchmark test
console.log(chalk.green('📈 Running Vitest Benchmark Test...'));

try {
  // Run the benchmark test (we're already in the correct directory)
  await $`pnpm bench`;

  console.log('');
  console.log(chalk.green('✅ Performance tests completed!'));
} catch (error) {
  console.log('');
  console.log(chalk.red('❌ Performance tests failed!'));
  console.log(chalk.red(`Error: ${error.message}`));

  // Provide troubleshooting tips
  console.log('');
  console.log(chalk.yellow('🔧 Troubleshooting Tips:'));
  console.log(chalk.gray("   1. Make sure you're in the correct directory"));
  console.log(chalk.gray('   2. Check if PRISMA_DATABASE_URL is set correctly'));
  console.log(chalk.gray('   3. Ensure the database is accessible'));
  console.log(chalk.gray('   4. Try running: pnpm install'));
  console.log(chalk.gray('   5. Check if the test files exist'));

  process.exit(1);
}

console.log('');
console.log(chalk.cyan('📋 Results Summary:'));
console.log(chalk.gray('   - Check console output above for timing results'));
console.log(chalk.gray('   - Look for benchmark statistics (avg, min, max)'));
console.log(chalk.gray('   - Compare PostgreSQL vs SQLite performance'));
console.log('');
console.log(chalk.cyan('💡 Tips:'));
console.log(chalk.gray('   - Run tests multiple times for consistent results'));
console.log(chalk.gray('   - Monitor system resources during tests'));
console.log(chalk.gray('   - Adjust RECORD_COUNT in test files for different scales'));
console.log(chalk.gray('   - Use pnpm bench for interactive mode'));

// Additional commands for reference
console.log('');
console.log(chalk.cyan('🚀 Additional Commands:'));
console.log(chalk.gray('   Interactive mode: pnpm bench'));
console.log(chalk.gray('   PostgreSQL only: pnpm bench-run -t "PostgreSQL"'));
console.log(chalk.gray('   SQLite only: pnpm bench-run -t "SQLite"'));
console.log(
  chalk.gray('   With more memory: NODE_OPTIONS="--max-old-space-size=8192" pnpm bench-run')
);
