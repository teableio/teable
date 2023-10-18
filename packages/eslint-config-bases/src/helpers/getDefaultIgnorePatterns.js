const getDefaultIgnorePatterns = () => {
  // Hacky way to silence @yarnpkg/doctor about node_modules detection
  return [
    `${'node'}_modules}`,
    `**/${'node'}_modules}`,
    '**/.cache',
    'build',
    'dist',
    'storybook-static',
    '.yarn',
    '.turbo',
    `**/.turbo`,
    '.out',
  ];
};

module.exports = {
  getDefaultIgnorePatterns,
};
