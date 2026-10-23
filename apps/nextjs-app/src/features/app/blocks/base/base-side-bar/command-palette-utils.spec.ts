import { describe, expect, it } from 'vitest';
import {
  createPaletteSearchIndex,
  looksLikeNaturalLanguage,
  parsePaletteQuery,
  searchPaletteEntries,
} from './command-palette-utils';

describe('palette matching', () => {
  it('orders exact, prefix, word-prefix, substring, initials and pinyin matches ahead of frequency', () => {
    const index = createPaletteSearchIndex([
      { id: 'substring', label: 'mycustomers', lastVisited: 100, visitCount: 100 },
      { id: 'word', label: 'New customers' },
      { id: 'prefix', label: 'Customers archive' },
      { id: 'exact', label: 'Customers' },
    ]);
    expect(searchPaletteEntries(index, 'customers', 100).map(({ id }) => id)).toEqual([
      'exact',
      'prefix',
      'word',
      'substring',
    ]);
    const chinese = createPaletteSearchIndex([{ id: 'table', label: '客户表' }]);
    expect(searchPaletteEntries(chinese, 'khb').map(({ id }) => id)).toEqual(['table']);
    expect(searchPaletteEntries(chinese, 'kehu').map(({ id }) => id)).toEqual(['table']);
    expect(searchPaletteEntries(chinese, 'unrelated')).toEqual([]);
  });

  it('ranks Chinese word starts above substrings even when the substring is visited more', () => {
    const index = createPaletteSearchIndex([
      { id: 'substring', label: '项目标题', lastVisited: 100, visitCount: 100 },
      { id: 'word', label: '季度目标' },
    ]);
    expect(searchPaletteEntries(index, '目标', 100).map(({ id }) => id)).toEqual([
      'word',
      'substring',
    ]);
  });

  it('identifies the Chinese characters selected by full pinyin and initials', () => {
    const index = createPaletteSearchIndex([{ id: 'customers', label: '客户表' }]);
    expect(searchPaletteEntries(index, 'kehu')[0].matchRanges).toEqual([[0, 2]]);
    expect(searchPaletteEntries(index, 'khb')[0].matchRanges).toEqual([[0, 3]]);
  });

  it('breaks equal textual matches by recent use and deduplicates the same destination', () => {
    const index = createPaletteSearchIndex([
      { id: 'old', label: 'Customers', href: '/old', lastVisited: 1, visitCount: 1 },
      { id: 'new', label: 'Customers', href: '/new', lastVisited: 86400001, visitCount: 2 },
      { id: 'duplicate', label: 'Customers', href: '/new' },
    ]);
    expect(searchPaletteEntries(index, 'customers', 86400001).map(({ id }) => id)).toEqual([
      'new',
      'old',
    ]);
  });

  it('recognizes the approved Chinese prompts without treating a short resource name as AI', () => {
    expect(looksLikeNaturalLanguage('分析本月回款')).toBe(true);
    expect(looksLikeNaturalLanguage('按地区汇总客户金额')).toBe(true);
    expect(looksLikeNaturalLanguage('帮我按地区汇总客户金额')).toBe(true);
    expect(looksLikeNaturalLanguage('How many customers are active?')).toBe(true);
    expect(looksLikeNaturalLanguage('客户表')).toBe(false);
  });

  it('removes only the command prefix and surrounding query whitespace', () => {
    expect(parsePaletteQuery('  >  新建表  ')).toEqual({ commandMode: true, query: '新建表' });
    expect(parsePaletteQuery('客户表')).toEqual({ commandMode: false, query: '客户表' });
  });
});
