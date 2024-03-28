import dayjs from 'dayjs';
import 'dayjs/plugin/utc';

export function getOffset(timeZone: string) {
  const offsetMinutes = dayjs().tz(timeZone).utcOffset();

  const offsetHours = offsetMinutes / 60;
  return offsetHours >= 0 ? `+${offsetHours}` : `${offsetHours}`;
}
