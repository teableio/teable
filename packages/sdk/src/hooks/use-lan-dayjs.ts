import dayjs from 'dayjs';
import 'dayjs/locale/zh';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);
import { useCallback } from 'react';
import { useTranslation } from '../context/app/i18n';
import { useIsHydrated } from './use-is-hydrated';

export const useLanDayjs = () => {
  const { lang } = useTranslation();
  const isHydrated = useIsHydrated();
  return useCallback(
    (t: dayjs.ConfigType) => (isHydrated ? dayjs(t).locale(lang as string) : dayjs(t)),
    [lang, isHydrated]
  );
};
