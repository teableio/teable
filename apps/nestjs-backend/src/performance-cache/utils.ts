export const generateHash = (data: unknown): string => {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff; // NOSONAR typescript:S7758 -- the hash is defined over UTF-16 code units; switching to code points would change persisted/compared values
  }
  return Math.abs(hash).toString(36);
};
