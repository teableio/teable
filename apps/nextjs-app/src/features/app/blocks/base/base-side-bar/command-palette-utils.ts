import { match as matchPinyin, pinyin } from 'pinyin-pro';
import type { PaletteEntry } from './palette-types';

export interface PaletteSearchEntry {
  entry: PaletteEntry;
  name: string;
  words: string[];
  aliases: string[];
  initials: string;
  phonetic: string;
}

export const parsePaletteQuery = (raw: string) => {
  const trimmed = raw.trimStart();
  const commandMode = trimmed.startsWith('>');
  return { commandMode, query: (commandMode ? trimmed.slice(1) : raw).trim() };
};

export const looksLikeNaturalLanguage = (query: string) => {
  const text = query.trim();
  return (
    /[?？]$/.test(text) ||
    /^(?:请|帮我|帮忙|如何|怎么|为什么|分析|总结|汇总|统计|生成|把).{3,}/u.test(text) ||
    /^按.+(?:汇总|统计|分组|排序)/u.test(text) ||
    /^(?:how|why|what|where|can you|could you|please|help me|summari[sz]e|analy[sz]e)\b.+/i.test(
      text
    ) ||
    text.length >= 24
  );
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

const getMatchRanges = (label: string, query: string): [number, number][] => {
  const literalStart = label.toLocaleLowerCase().indexOf(query);
  if (literalStart >= 0) return [[literalStart, literalStart + query.length]];
  const indices = matchPinyin(label, query, {
    continuous: false,
    precision: 'any',
    insensitive: true,
  });
  const ranges: [number, number][] = [];
  for (const index of indices ?? []) {
    const previous = ranges[ranges.length - 1];
    if (previous?.[1] === index) previous[1] = index + 1;
    else ranges.push([index, index + 1]);
  }
  return ranges;
};

export const createPaletteSearchIndex = (entries: PaletteEntry[]): PaletteSearchEntry[] =>
  entries.map((entry) => {
    const name = normalize(entry.label);
    const syllables = /\p{Script=Han}/u.test(name)
      ? pinyin(name, { toneType: 'none', type: 'array' })
      : [];
    return {
      entry,
      name,
      words: Array.from(wordSegmenter.segment(name))
        .filter((word) => word.isWordLike)
        .map((word) => word.segment),
      aliases: (entry.keywords ?? []).map(normalize),
      initials: syllables.map((syllable) => syllable[0]).join(''),
      phonetic: syllables.join(''),
    };
  });

const isSubsequence = (query: string, value: string) => {
  let index = 0;
  for (const character of value) {
    if (character === query[index]) index++;
    if (index === query.length) return true;
  }
  return false;
};

const matchScore = (item: PaletteSearchEntry, query: string) => {
  if (item.name === query || item.aliases.includes(query)) return 1000;
  if (item.name.startsWith(query)) return 800;
  if (item.words.some((word) => word.startsWith(query))) return 600;
  if (item.name.includes(query) || item.aliases.some((alias) => alias.includes(query))) return 400;
  if (item.initials.includes(query)) return 320;
  if (item.phonetic.includes(query)) return 300;
  if (query.length >= 2 && isSubsequence(query, item.phonetic || item.name)) return 200;
  return 0;
};

export const searchPaletteEntries = (
  index: PaletteSearchEntry[],
  raw: string,
  now = Date.now()
) => {
  const query = normalize(raw);
  const seen = new Set<string>();
  return index
    .map((item) => {
      const match = query ? matchScore(item, query) : 1;
      const ageDays = item.entry.lastVisited
        ? Math.max(0, now - item.entry.lastVisited) / 86400000
        : Infinity;
      const recency = Number.isFinite(ageDays) ? 40 / (1 + ageDays) : 0;
      const frequency = Math.min(20, (item.entry.visitCount ?? 0) * 2);
      return { entry: item.entry, score: match ? match + recency + frequency : 0 };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.entry.lastVisited ?? 0) - (a.entry.lastVisited ?? 0))
    .filter(({ entry }) => {
      const identity = entry.href ?? entry.id;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .map(({ entry }) =>
      query ? { ...entry, matchRanges: getMatchRanges(entry.label, query) } : entry
    );
};
