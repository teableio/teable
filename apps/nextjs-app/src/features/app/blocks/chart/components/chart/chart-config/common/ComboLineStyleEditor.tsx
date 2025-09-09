import { Label, RadioGroup, RadioGroupItem } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import type { IChartBaseAxisDisplay } from '../../../../types';

type ILineStyle = Extract<IChartBaseAxisDisplay, { lineStyle: unknown }>['lineStyle'];

export const ComboLineStyleEditor = (props: {
  value?: ILineStyle;
  onChange: (value: ILineStyle) => void;
}) => {
  const { value: displayValue, onChange } = props;
  const { t } = useTranslation('chart');
  const lineStyles = useMemo(() => {
    return [
      {
        label: t('form.combo.lineStyle.normal'),
        value: 'normal',
      },
      {
        label: t('form.combo.lineStyle.linear'),
        value: 'linear',
      },
      {
        label: t('form.combo.lineStyle.step'),
        value: 'step',
      },
    ];
  }, [t]);

  return (
    <RadioGroup className="flex gap-4" value={displayValue} onValueChange={onChange}>
      {lineStyles.map(({ label, value }) => (
        <div key={value} className="flex items-center gap-2">
          <RadioGroupItem value={value} id={value} />
          <Label
            title={label}
            htmlFor={value}
            className="flex items-center gap-2 text-xs font-normal"
          >
            {label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
};
