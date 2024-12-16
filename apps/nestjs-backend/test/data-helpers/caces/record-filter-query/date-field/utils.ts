import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { x_20 } from '../../../20x';
import { DEFAULT_LINK_VALUE_INDEXS } from '../../../20x-link';

export const getDates = () => {
  const tz = 'Asia/Singapore';
  const dateFieldName = x_20.fields[3].name;
  dayjs.locale(dayjs.locale(), {
    weekStart: 1,
  });
  const dates = x_20.records
    .filter((r) => r.fields?.[dateFieldName])
    .map((r) => {
      const date = r.fields[dateFieldName];
      return typeof date === 'string' ? dayjs.utc(date).tz(tz) : date;
    }) as Dayjs[];

  const lookupDates = DEFAULT_LINK_VALUE_INDEXS.map((item) => {
    const records = x_20.records;
    const result = [] as Dayjs[];
    if (item?.length) {
      item.forEach((index) => {
        const date = records[index].fields[dateFieldName];
        if (date) {
          result.push(typeof date === 'string' ? dayjs.utc(date).tz(tz) : (date as Dayjs));
        }
      });
    }

    return result?.length ? result : null;
  }).filter((d) => d) as Dayjs[][];

  return {
    dates,
    lookupDates,
  };
};
