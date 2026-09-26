export const string2Hash = (str: string) => {
  let hash = 5381;
  let i = str.length;

  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i); // NOSONAR typescript:S7758 -- the hash is defined over UTF-16 code units; switching to code points would change persisted/compared values
  }

  return hash >>> 0;
};
