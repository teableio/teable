if (!process.env.SKIP_POSTINSTALL) {
  const isCI = require('is-ci');
  const { execSync } = require('child_process');
  if (!isCI) {
    execSync('yarn husky install', { stdio: 'inherit' });
  }
}
