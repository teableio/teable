import { Input } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import type { IChartXAxisDisplay } from '../../../../types';
import { ConfigItem } from './ConfigItem';

export const ComboXAxisDisplayEditor = (props: {
  value?: IChartXAxisDisplay;
  onChange: (value?: IChartXAxisDisplay) => void;
}) => {
  const { value: display, onChange } = props;
  const { t } = useTranslation('chart');
  const [value, setValue] = useState(display?.label || '');

  return (
    <ConfigItem label={t('form.label')}>
      <Input
        className="h-8 text-[13px]"
        value={value || ''}
        onBlur={() =>
          onChange({
            ...display,
            label: value,
          })
        }
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
    </ConfigItem>
  );
};
