import { useTranslation } from '../../../../context/app/i18n';

export const useDateI18nMap = () => {
  const { t } = useTranslation();

  return {
    // common
    today: t('filter.component.date.today'),
    tomorrow: t('filter.component.date.tomorrow'),
    yesterday: t('filter.component.date.yesterday'),
    oneWeekAgo: t('filter.component.date.oneWeekAgo'),
    oneWeekFromNow: t('filter.component.date.oneWeekFromNow'),
    oneMonthAgo: t('filter.component.date.oneMonthAgo'),
    oneMonthFromNow: t('filter.component.date.oneMonthFromNow'),
    daysAgo: t('filter.component.date.daysAgo'),
    daysFromNow: t('filter.component.date.daysFromNow'),
    exactDate: t('filter.component.date.exactDate'),

    // within
    pastWeek: t('filter.component.date.pastWeek'),
    pastMonth: t('filter.component.date.pastMonth'),
    pastYear: t('filter.component.date.pastYear'),
    nextWeek: t('filter.component.date.nextWeek'),
    nextMonth: t('filter.component.date.nextMonth'),
    nextYear: t('filter.component.date.nextYear'),
    pastNumberOfDays: t('filter.component.date.pastNumberOfDays'),
    nextNumberOfDays: t('filter.component.date.nextNumberOfDays'),
  };
};
