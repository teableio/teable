const buildVersionEnvKeys = ['BUILD_VERSION', 'NEXT_PUBLIC_BUILD_VERSION', 'APP_VERSION'] as const;

export const resolveBuildVersion = () => {
  for (const key of buildVersionEnvKeys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return '';
};
