import { ChevronDown } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { AIModelSelect } from '@/features/app/blocks/admin/setting/components/ai-config/AiModelSelect';
import { parseModelKey } from '@/features/app/blocks/admin/setting/components/ai-config/utils';

export const ModelSelector = ({
  models,
  value,
  onValueChange,
}: {
  models: { modelKey: string; isInstance?: boolean }[];
  value: string;
  onValueChange: (value: string) => void;
}) => {
  const { t } = useTranslation(['sdk']);
  const displayValue = useMemo(() => {
    if (value) {
      return parseModelKey(value).name;
    }
  }, [value]);
  return (
    <AIModelSelect needGroup options={models} value={value} onValueChange={onValueChange}>
      <Button variant="ghost" size="xs" className="overflow-hidden px-0 text-muted-foreground">
        <span title={displayValue} className="truncate">
          {displayValue || t('sdk:common.selectPlaceHolder')}
        </span>
        <ChevronDown className="size-4 shrink-0" />
      </Button>
    </AIModelSelect>
  );
};
