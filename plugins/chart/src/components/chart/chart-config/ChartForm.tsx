import { useTranslation } from 'react-i18next';
import type { IChartConfig } from '../../types';
import { AreaForm } from './form/AreaForm';
import { BarForm } from './form/BarForm';
import { LineForm } from './form/LineForm';
import { PieForm } from './form/PieForm';

export const ChartForm = (props: {
  value: IChartConfig;
  onChange: (value: IChartConfig) => void;
}) => {
  const { value, onChange } = props;
  const { t } = useTranslation();
  switch (value.type) {
    case 'bar':
      return <BarForm config={value} onChange={onChange} />;
    case 'line':
      return <LineForm config={value} onChange={onChange} />;
    case 'area':
      return <AreaForm config={value} onChange={onChange} />;
    case 'pie':
      return <PieForm config={value} onChange={onChange} />;
    case 'table':
      return;
    default:
      throw new Error(t('form.typeError'));
  }
};
