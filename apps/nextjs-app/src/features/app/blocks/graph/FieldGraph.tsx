import type { FieldAction, IFieldRo } from '@teable/core';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Badge } from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useTranslation } from 'next-i18next';
import { usePlan } from './usePlan';

dayjs.extend(duration);
dayjs.extend(relativeTime);

export const FieldGraph = (params: {
  tableId: string;
  fieldId?: string;
  fieldRo?: IFieldRo;
  fieldAction?: FieldAction;
}) => {
  const planData = usePlan(params);
  const updateCellCount = planData?.updateCellCount;
  const linkFieldCount = planData?.linkFieldCount;
  const estimateTime = planData?.estimateTime || 0;
  const { t, i18n } = useTranslation(['table']);
  const dayjs = useLanDayjs();
  const formatDuration = dayjs(Date.now() + estimateTime).fromNow();

  return (
    <div className="flex flex-col gap-2 pb-2">
      <div className="flex items-center gap-2 text-xs">
        <div>
          {t('table.graph.effectCells')}:{' '}
          <Badge>{Intl.NumberFormat(i18n.language).format(updateCellCount || 0)}</Badge>
        </div>
        <div>
          {t('table.graph.estimatedTime')}: <b>{formatDuration}</b>
        </div>
      </div>
      {linkFieldCount && linkFieldCount > 0 ? (
        <div className="flex items-center gap-2 text-xs">
          {t('table.graph.linkFieldCount')}:{' '}
          <Badge>{Intl.NumberFormat(i18n.language).format(linkFieldCount)}</Badge>
        </div>
      ) : null}
    </div>
  );
};
