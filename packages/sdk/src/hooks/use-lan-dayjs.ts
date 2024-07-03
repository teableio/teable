import dayjs from 'dayjs';
import 'dayjs/locale/zh';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);
import { useCallback } from 'react';
import { useTranslation } from '../context/app/i18n';

export const useLanDayjs = () => {
  const { lang } = useTranslation();
  return useCallback((t: dayjs.ConfigType) => dayjs(t).locale(lang as string), [lang]);
};
