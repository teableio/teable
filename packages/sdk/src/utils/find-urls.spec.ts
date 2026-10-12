import { describe, expect, it } from 'vitest';
import { findUrls } from './find-urls';

const urlsOf = (text: string) => findUrls(text).map((m) => m.url);

describe('findUrls', () => {
  it('returns offsets that slice back to the url', () => {
    const text = '网址是 https://google.com 哈哈哈';
    const [match] = findUrls(text);
    expect(match).toEqual({ start: 4, end: 22, url: 'https://google.com' });
    expect(text.slice(match.start, match.end)).toBe(match.url);
  });

  it('stops at CJK text glued to the host', () => {
    expect(urlsOf('网址是https://google.com哈哈哈')).toEqual(['https://google.com']);
    expect(urlsOf('看这个（https://google.com）就行')).toEqual(['https://google.com']);
    expect(urlsOf('链接：https://example.com/a?b=1。谢谢')).toEqual(['https://example.com/a?b=1']);
  });

  it('keeps CJK inside the path unless it continues an ASCII word', () => {
    expect(urlsOf('https://zh.wikipedia.org/wiki/中文 页面')).toEqual([
      'https://zh.wikipedia.org/wiki/中文',
    ]);
    expect(urlsOf('搜索 https://example.com/搜索?q=中文，然后回来')).toEqual([
      'https://example.com/搜索?q=中文',
    ]);
    expect(urlsOf('文档在https://teable.io/docs看看')).toEqual(['https://teable.io/docs']);
  });

  it('recognises www. hosts and bare domains from the curated tld list', () => {
    expect(urlsOf('see google.com or www.teable.io/docs.')).toEqual([
      'google.com',
      'www.teable.io/docs',
    ]);
    expect(urlsOf('teable.io/docs 和 app.teable.ai 以及 foo.bar')).toEqual([
      'teable.io/docs',
      'app.teable.ai',
    ]);
    expect(urlsOf('访问google.com.cn')).toEqual(['google.com.cn']);
  });

  it('ignores version numbers, file names and abbreviations', () => {
    expect(urlsOf('价格 3.5 元 version1.0 1.2.3 e.g. i.e.')).toEqual([]);
    expect(urlsOf('改 readme.md main.py index.js app.tsx style.css run.sh')).toEqual([]);
    expect(urlsOf('v2.5.3 vs node.js vs Next.js')).toEqual([]);
  });

  it('ignores emails and non-http schemes', () => {
    expect(urlsOf('邮箱 a@b.com 不算，javascript:alert(1) 也不算')).toEqual([]);
    expect(urlsOf('foo@www.x.com mailto:x@y.org ftp://x.org')).toEqual([]);
  });

  it('trims trailing punctuation and unbalanced brackets', () => {
    expect(urlsOf('https://en.wikipedia.org/wiki/Foo_(bar) 和 (https://a.io/x)')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
      'https://a.io/x',
    ]);
    expect(urlsOf('[https://a.io/x]. done!')).toEqual(['https://a.io/x']);
    expect(urlsOf('"https://x.com/y" 与 <https://x.com/z>')).toEqual([
      'https://x.com/y',
      'https://x.com/z',
    ]);
  });

  it('requires a host after a scheme or www. prefix', () => {
    expect(urlsOf('https:// and www. alone')).toEqual([]);
  });

  it('preserves case, port, path, query and hash', () => {
    expect(urlsOf('HTTP://LOCALHOST:3000/Path?x=1#h')).toEqual([
      'HTTP://LOCALHOST:3000/Path?x=1#h',
    ]);
  });

  it('keeps userinfo and ipv6 authorities after a scheme but not for bare domains', () => {
    expect(urlsOf('https://user@example.com/path')).toEqual(['https://user@example.com/path']);
    expect(urlsOf('https://user+tag@example.com/path')).toEqual([
      'https://user+tag@example.com/path',
    ]);
    expect(urlsOf('https://us%40er:p=1@example.com/ 完')).toEqual([
      'https://us%40er:p=1@example.com/',
    ]);
    expect(urlsOf('http://[::1]:3000/x ok')).toEqual(['http://[::1]:3000/x']);
    expect(urlsOf('see example.com@2x.png')).toEqual(['example.com']);
  });

  it('stays linear on a long run of unmatched closing brackets', () => {
    const text = `https://example.com/${')'.repeat(32000)}`;
    const started = performance.now();
    expect(urlsOf(text)).toEqual(['https://example.com/']);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('stays linear on a long token without dots and keeps long paths intact', () => {
    const token = 'a'.repeat(32000);
    const started = performance.now();
    expect(findUrls(token)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(100);

    const longUrl = `https://example.com${'/segment'.repeat(1000)}?q=${'x'.repeat(2000)}`;
    expect(urlsOf(`see ${longUrl} end`)).toEqual([longUrl]);
  });

  it('stays linear on long dot chains that never form a domain', () => {
    const chain = Array.from({ length: 4000 }, (_, i) => i).join('.');
    const started = performance.now();
    expect(findUrls(chain)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('handles multiple urls and newlines', () => {
    expect(urlsOf('a https://x.com\nb www.y.org\nc')).toEqual(['https://x.com', 'www.y.org']);
  });

  it('returns an empty array for empty or plain text', () => {
    expect(findUrls('')).toEqual([]);
    expect(findUrls('hello world')).toEqual([]);
  });
});
