import { Input, Label } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import type { IChartPadding } from '../../../../types';

export const PaddingEditor = (props: {
  value?: IChartPadding;
  onChange: (value?: IChartPadding) => void;
}) => {
  const { value, onChange } = props;
  const { t } = useTranslation('chart');
  const [padding, setPadding] = useState(value);
  return (
    <div className="flex flex-col gap-2 p-0.5">
      <div className="flex items-center gap-2">
        <Label className="w-14 text-right text-xs">{t('form.padding.top')}</Label>
        <Input
          type="number"
          className="h-7 text-[13px]"
          value={padding?.top || ''}
          onBlur={() => onChange(padding)}
          onChange={(e) => {
            const number = parseFloat(e.target.value);
            setPadding({
              ...padding,
              top: isNaN(number) ? undefined : number,
            });
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-right text-xs">{t('form.padding.right')}</Label>
        <Input
          type="number"
          className="h-7 text-[13px]"
          value={padding?.right || ''}
          onBlur={() => onChange(padding)}
          onChange={(e) => {
            const number = parseFloat(e.target.value);
            setPadding({
              ...padding,
              right: isNaN(number) ? undefined : number,
            });
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-right text-xs">{t('form.padding.bottom')}</Label>
        <Input
          type="number"
          className="h-7 text-[13px]"
          value={padding?.bottom || ''}
          onBlur={() => onChange(padding)}
          onChange={(e) => {
            const number = parseFloat(e.target.value);
            setPadding({
              ...padding,
              bottom: isNaN(number) ? undefined : number,
            });
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-right text-xs">{t('form.padding.left')}</Label>
        <Input
          type="number"
          className="h-7 text-[13px]"
          value={padding?.left || ''}
          onBlur={() => onChange(padding)}
          onChange={(e) => {
            const number = parseFloat(e.target.value);
            setPadding({
              ...padding,
              left: isNaN(number) ? undefined : number,
            });
          }}
        />
      </div>
    </div>
  );
};
