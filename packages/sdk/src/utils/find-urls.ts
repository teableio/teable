import { LRUCache } from 'lru-cache';

export interface IUrlMatch {
  // Offsets into the source text, end exclusive
  start: number;
  end: number;
  url: string;
}

// Bare domains (no scheme, no www.) are only recognised against this curated
// list so that file names like readme.md / main.py / run.sh never light up.
// Anything with a scheme or a www. prefix is recognised regardless of TLD.
const BARE_DOMAIN_TLDS = [
  'com|net|org|io|ai|app|dev|co|cn|hk|tw|jp|kr|sg|uk|us|de|fr|ru|in|au|ca|br|eu|me|tv|cc',
  'info|biz|xyz|site|online|cloud|tech|design|edu|gov|mil|int|pro|shop|store|link|top',
  'vip|club|wiki|ly|to|so|im|gg|fm|ch|nl|se|no|es|it|pl|ir|id|my|th|vn|ph|nz|za|mx|ar',
  'cl|pe|tr|ua|cz|at|be|dk|fi|ie|pt|gr|hu|ro|il|ae|sa|pk|bd|lk|np|kz|nu|ws',
].join('|');

// Label length (DNS max 63) and label count are bounded so a failed scan stays
// linear: without them a long dot-less token or an unbroken dot chain
// ("1.2.3.4.5…") makes the engine rescan from every character.
const URL_START_RE = new RegExp(
  `https?://|www\\.|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){1,8}(?:${BARE_DOMAIN_TLDS})(?![a-z0-9-])`,
  'gi'
);

const SCHEME_RE = /^https?:\/\//i;
const HOST_CHAR_RE = /[\w.:-]/;
// After a scheme the authority may carry userinfo (https://user+tag@host/x,
// percent-encoded or with =) and IPv6 brackets (http://[::1]:3000/x); bare
// domains stay strict so a file name like example.com@2x.png does not swallow
// the suffix. Prose delimiters such as , ; ( ) are left out on purpose.
const AUTHORITY_CHAR_RE = /[\w.:@[\]~%+=!$&*-]/;
const PATH_START_RE = /[/?#]/;
const ASCII_ALNUM_RE = /[a-z0-9]/i;
// A bare domain / www. must not be glued to a preceding word, dot, slash or @
// (emails, ftp://x.org, paths)
const BARE_BOUNDARY_RE = /[\w.@/-]/;
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?']);
const BRACKET_PAIRS = new Map([
  [')', '('],
  [']', '['],
]);
const BRACKETS = new Set([...BRACKET_PAIRS.keys(), ...BRACKET_PAIRS.values()]);
// Whitespace, ASCII characters that never appear in a URL, general and CJK
// punctuation (quotes, dashes, ellipsis, 。，（）「」 and full-width forms)
const STOP_CHAR_RE =
  /[\t\n\v\f\r \u00a0<>"'`|\\^{}\u2000-\u206f\u3000-\u303f\ufe30-\ufe4f\uff00-\uffef]/;
// Hiragana, Katakana, CJK ideographs, Hangul
const CJK_LETTER_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

// Drops trailing punctuation and closing brackets that have no opening
// counterpart inside the URL, so "(https://a.io/x)" stops before ")" but
// ".../Foo_(bar)" keeps it. Bracket counts are taken once and the end index
// walks backwards, so a long run of ")" stays linear.
const trimTrailing = (url: string) => {
  const counts = new Map<string, number>();
  for (const char of url) {
    if (BRACKETS.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let end = url.length;
  while (end > 0) {
    const last = url[end - 1];
    if (TRAILING_PUNCT.has(last)) {
      end--;
      continue;
    }
    const open = BRACKET_PAIRS.get(last);
    const closeCount = counts.get(last) ?? 0;
    if (open == null || (counts.get(open) ?? 0) >= closeCount) break;
    counts.set(last, closeCount - 1);
    end--;
  }
  return url.slice(0, end);
};

// Walks forward from the end of the start match and returns the exclusive end
// of the URL body. The host only accepts hostname characters, so CJK text glued
// to a domain ("google.com哈哈") ends the URL. Once inside the path CJK is
// allowed ("/wiki/中文", "?q=中文") unless it directly follows ASCII letters or
// digits ("/docs看看"), which reads as prose continuing after the URL.
const scanUrlEnd = (text: string, from: number, hasScheme: boolean) => {
  const hostCharRe = hasScheme ? AUTHORITY_CHAR_RE : HOST_CHAR_RE;
  let inPath = false;
  let prev = text[from - 1];
  let i = from;
  for (; i < text.length; i++) {
    const char = text[i];
    if (STOP_CHAR_RE.test(char)) break;
    if (CJK_LETTER_RE.test(char)) {
      if (!inPath || ASCII_ALNUM_RE.test(prev)) break;
    } else if (!inPath) {
      if (PATH_START_RE.test(char)) inPath = true;
      else if (!hostCharRe.test(char)) break;
    }
    prev = char;
  }
  return i;
};

const EMPTY: IUrlMatch[] = [];
// Keyed by the full text (grid display strings, long text previews, editor
// input), so the budget is in characters rather than entries
const cache = new LRUCache<string, IUrlMatch[]>({
  max: 5000,
  maxSize: 1_000_000,
  sizeCalculation: (_value, key) => key.length + 1,
});

// Finds http(s) URLs, www. hosts and bare domains inside free text, tuned for
// CJK prose where URLs are commonly written without surrounding spaces.
export const findUrls = (text: string): IUrlMatch[] => {
  if (!text) return EMPTY;
  const cached = cache.get(text);
  if (cached) return cached;

  const matches: IUrlMatch[] = [];
  URL_START_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_START_RE.exec(text))) {
    const start = match.index;
    const prefix = match[0];
    const hasScheme = SCHEME_RE.test(prefix);
    if (!hasScheme && start > 0 && BARE_BOUNDARY_RE.test(text[start - 1])) {
      URL_START_RE.lastIndex = start + 1;
      continue;
    }

    const end = scanUrlEnd(text, start + prefix.length, hasScheme);
    const url = trimTrailing(text.slice(start, end));
    // "https://" and "www." are only prefixes and need a host after them; a
    // bare-domain match already is the host.
    const isBareDomain = !hasScheme && prefix.toLowerCase() !== 'www.';
    if (isBareDomain || url.length > prefix.length) {
      matches.push({ start, end: start + url.length, url });
    }
    URL_START_RE.lastIndex = Math.max(start + url.length, start + 1);
  }

  const result = matches.length ? matches : EMPTY;
  cache.set(text, result);
  return result;
};
