import { Spin } from '@teable/ui-lib';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useBaseQueryData } from '../../../hooks/useBaseQueryData';
import { ChartContext } from '../../ChartProvider';
import { ChartCombo } from './combo/Combo';
import { ChartPie } from './pie/Pie';
import { ChartTable } from './table/ChartTable';

export const ChartDisplay = (props: { previewTable?: boolean }) => {
  const { previewTable } = props;
  const { storage, queryError } = useContext(ChartContext);
  const queryData = useBaseQueryData();

  const { t } = useTranslation();

  if (queryError) {
    return (
      <div className="font-sm text-destructive flex size-full items-center justify-center text-center">
        Error: {queryError}
      </div>
    );
  }

  if (!queryData) {
    return (
      <div>
        <Spin />
      </div>
    );
  }

  if (previewTable) {
    return <ChartTable />;
  }
  if (!storage?.config?.type) {
    return;
  }
  switch (storage?.config?.type) {
    case 'bar':
    case 'line':
    case 'area':
      return <ChartCombo config={storage.config} defaultType={storage?.config?.type} />;
    case 'pie':
      return <ChartPie config={storage.config} />;
    case 'table':
      return <ChartTable config={storage.config} />;
    default:
      return <div>{t('notSupport')}</div>;
  }
};
