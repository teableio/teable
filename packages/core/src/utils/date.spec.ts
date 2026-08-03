import { DateUtil } from './date';

describe('DateUtil Test', () => {
  const utcDateStr = '2023-07-15T16:00:00.000Z';

  it('America/Los_Angeles', () => {
    const dateUtil = new DateUtil('America/Los_Angeles');

    expect(dateUtil.date(utcDateStr).format()).toStrictEqual('2023-07-15T09:00:00-07:00');
    expect(dateUtil.date(utcDateStr).format(DateUtil.NORM_DATETIME_PATTERN)).toStrictEqual(
      '2023-07-15 09:00:00'
    );
    expect(dateUtil.date(utcDateStr).toISOString()).toStrictEqual(utcDateStr);

    expect(
      dateUtil.offsetDay(1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-07-16 09:00:00');
    expect(
      dateUtil.offsetDay(-1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-07-14 09:00:00');

    expect(
      dateUtil.offsetWeek(1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-07-22 09:00:00');
    expect(
      dateUtil.offsetWeek(-1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-07-08 09:00:00');

    expect(
      dateUtil.offsetMonth(1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-08-15 09:00:00');
    expect(
      dateUtil.offsetMonth(-1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-06-15 09:00:00');
  });

  it('Asia/Shanghai', () => {
    const dateUtil = new DateUtil('Asia/Shanghai');

    expect(dateUtil.date(utcDateStr).format()).toStrictEqual('2023-07-16T00:00:00+08:00');
    expect(dateUtil.date(utcDateStr).format(DateUtil.NORM_DATETIME_PATTERN)).toStrictEqual(
      '2023-07-16 00:00:00'
    );
    expect(dateUtil.date(utcDateStr).toISOString()).toStrictEqual(utcDateStr);

    expect(
      dateUtil.offsetDay(1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-07-17 00:00:00');
    expect(
      dateUtil.offsetDay(-1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-07-15 00:00:00');

    expect(
      dateUtil.offsetWeek(1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-07-23 00:00:00');
    expect(
      dateUtil.offsetWeek(-1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-07-09 00:00:00');

    expect(
      dateUtil.offsetMonth(1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-08-16 00:00:00');
    expect(
      dateUtil.offsetMonth(-1, dateUtil.date(utcDateStr)).format(DateUtil.NORM_DATETIME_PATTERN)
    ).toStrictEqual('2023-06-16 00:00:00');
  });
});
