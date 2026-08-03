export const replaceSuffix = (originalUrl: string, storagePrefix: string) => {
  const original = new URL(originalUrl);
  const suffix = new URL(storagePrefix);

  const suffixPath = suffix.pathname.endsWith('/') ? suffix.pathname : suffix.pathname + '/';
  const originalPath = original.pathname.startsWith('/')
    ? original.pathname.slice(1)
    : original.pathname;

  return `${suffix.origin}${suffixPath}${originalPath}${original.search}${original.hash}`;
};
