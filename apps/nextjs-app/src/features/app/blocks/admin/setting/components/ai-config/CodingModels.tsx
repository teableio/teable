import type { IAIIntegrationConfig } from '@teable/openapi';
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
  Tooltip as ShadTooltip,
} from '@teable/ui-lib/shadcn';
import { Cpu, Code, Zap } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { AIModelSelect, type IModelOption } from './AiModelSelect';

export const CodingModels = ({
  value,
  onChange,
  models,
}: {
  value: IAIIntegrationConfig['codingModels'];
  onChange: (value: IAIIntegrationConfig['codingModels']) => void;
  models?: IModelOption[];
}) => {
  const { t } = useTranslation('common');

  const icons = useMemo(() => {
    return {
      sm: <Zap className="size-4 text-emerald-500" />,
      md: <Code className="size-4 text-blue-500" />,
      lg: <Cpu className="size-4 text-purple-500" />,
    };
  }, []);
  return (
    <div className="flex flex-1 flex-col gap-2">
      {(['sm', 'md', 'lg'] as const).map((key) => (
        <div key={key} className="flex gap-2">
          <div className="flex items-center gap-2 text-sm">
            {icons[key]}
            <Tooltip content={t(`admin.setting.ai.codingModels.${key}Description`)}>
              <span>{t(`admin.setting.ai.codingModels.${key}`)}</span>
            </Tooltip>
          </div>
          <AIModelSelect
            key={key}
            value={value?.[key] ?? ''}
            onValueChange={(model) => {
              onChange({ ...value, [key]: model });
            }}
            options={models}
          />
        </div>
      ))}
    </div>
  );
};

const Tooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
  return (
    <TooltipProvider>
      <ShadTooltip>
        <TooltipTrigger asChild>
          <div>{children}</div>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>{content}</TooltipContent>
        </TooltipPortal>
      </ShadTooltip>
    </TooltipProvider>
  );
};
