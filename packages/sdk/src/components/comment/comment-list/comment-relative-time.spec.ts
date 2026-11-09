import dayjs from 'dayjs';
import 'dayjs/locale/zh';
import relativeTime from 'dayjs/plugin/relativeTime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCommentRelativeTime } from './commentRelativeTime';

dayjs.extend(relativeTime);

const zhDayjs = (t: dayjs.ConfigType) => dayjs(t).locale('zh');
const enDayjs = (t: dayjs.ConfigType) => dayjs(t).locale('en');

// T2154: a comment pushed in real time carries the server's createdTime. When the
// viewer's clock runs even slightly behind the server, the label must not read
// as a future time ("几秒后" / "in a few seconds").
describe('getCommentRelativeTime (T2154)', () => {
  const serverNow = new Date('2026-02-28T07:07:00.000Z');
  const createdTime = serverNow.toISOString(); // what the socket patch carries

  afterEach(() => vi.useRealTimers());

  it('never shows a just-created comment as being in the future', () => {
    // viewer's clock is 2s behind the server
    vi.useFakeTimers();
    vi.setSystemTime(new Date(serverNow.getTime() - 2000));

    expect(getCommentRelativeTime(zhDayjs, createdTime)).toBe('几秒前');
    expect(getCommentRelativeTime(enDayjs, createdTime)).toBe('a few seconds ago');
  });

  it('keeps the regular past-time label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(serverNow.getTime() + 60_000));

    expect(getCommentRelativeTime(zhDayjs, createdTime)).toBe('1 分钟前');
    expect(getCommentRelativeTime(enDayjs, createdTime)).toBe('a minute ago');
  });
});
