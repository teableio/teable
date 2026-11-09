import type dayjs from 'dayjs';

/**
 * Relative label for when a comment was posted.
 *
 * `createdTime` is stamped by the server, while `fromNow()` compares it with the
 * viewer's clock. A comment pushed in real time arrives a moment after it was
 * created, so if the viewer's clock lags the server even slightly the timestamp
 * lies in the "future" and would read "in a few seconds". A comment can't have
 * been posted later than now, so clamp it to now.
 */
export const getCommentRelativeTime = (
  lanDayjs: (t: dayjs.ConfigType) => dayjs.Dayjs,
  createdTime: dayjs.ConfigType,
  now: number = Date.now()
) => {
  const created = lanDayjs(createdTime);
  return (created.valueOf() > now ? lanDayjs(now) : created).fromNow();
};
