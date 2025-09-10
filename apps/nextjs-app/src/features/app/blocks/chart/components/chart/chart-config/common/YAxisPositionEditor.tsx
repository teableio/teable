import { Label, RadioGroup, RadioGroupItem } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import type { IChartBaseAxisDisplay } from '../../../../types';

export const YAxisPositionEditor = (props: {
  value?: IChartBaseAxisDisplay['position'];
  onChange: (value: IChartBaseAxisDisplay['position']) => void;
}) => {
  const { value: position, onChange } = props;
  const { t } = useTranslation(['chart']);
  const positions = useMemo(() => {
    return [
      {
        label: t('form.combo.position.auto'),
        value: 'auto',
      },
      {
        label: t('form.combo.position.left'),
        value: 'left',
      },
      {
        label: t('form.combo.position.right'),
        value: 'right',
      },
    ] as const;
  }, [t]);

  return (
    <RadioGroup className="flex gap-4" value={position} onValueChange={onChange}>
      {positions.map(({ label, value }) => (
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
