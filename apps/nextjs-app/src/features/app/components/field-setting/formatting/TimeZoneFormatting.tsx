import { TIME_ZONE_LIST } from '@teable/core';
import { Selector } from '@teable/ui-lib/base';
import { Label } from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
dayjs.extend(utc);
dayjs.extend(timezone);

function getUTCOffset(timeZone: string): string {
  const offsetMinutes = dayjs().tz(timeZone).utcOffset();

  const offsetHours = offsetMinutes / 60;

  return offsetHours >= 0 ? `UTC+${offsetHours}` : `UTC${offsetHours}`;
}

const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const TimeZoneFormatting = ({
  timeZone = systemTimeZone,
  onChange,
}: {
  timeZone?: string;
  onChange: (timeZone: string) => void;
}) => {
  const { t } = useTranslation(['common', 'table']);

  const timeZoneList = useMemo(
    () =>
      TIME_ZONE_LIST.map((item) => ({
        text: `${item} (${systemTimeZone === item ? t('common:settings.setting.system') : getUTCOffset(item)})`,
        value: item,
      })),
    [t]
  );

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{t('table:field.default.date.timeZone')}</Label>
      <Selector
        className="w-full"
        contentClassName="w-[333px]"
        candidates={timeZoneList.map((item) => ({ id: item.value, name: item.text }))}
        selectedId={timeZone}
        onChange={(value) => onChange(value)}
      />
    </div>
  );
};
