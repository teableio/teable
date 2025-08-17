import { chatModelAbilityType, type IAIIntegrationConfig } from '@teable/openapi';
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
  value: IAIIntegrationConfig['chatModel'];
  onChange: (value: IAIIntegrationConfig['chatModel']) => void;
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
      {(['lg', 'md', 'sm'] as const).map((key) => (
        <div key={key} className="relative flex items-center gap-2">
          <div className="flex w-32 shrink-0 items-center gap-2 truncate text-sm">
            {key === 'lg' && <div className="h-4 text-red-500">*</div>}
            {icons[key]}
            <Tooltip content={t(`admin.setting.ai.chatModels.${key}Description`)}>
              <span>{t(`admin.setting.ai.chatModels.${key}`)}</span>
            </Tooltip>
          </div>

          <AIModelSelect
            key={key}
            value={value?.[key] ?? ''}
            onValueChange={(model) => {
              if (key === 'lg') {
                onChange({ ...value, [key]: model, ability: {} });
              } else {
                onChange({ ...value, [key]: model });
              }
            }}
            options={models}
            className="flex-1"
          />
          {key === 'lg' && (
            <div className="flex gap-2">
              {Object.values(chatModelAbilityType.Values).map((type) => (
                <div
                  key={type}
                  className="flex items-center gap-1 rounded-md border px-1 py-0.5 text-xs"
                >
                  <span>{value?.ability?.[type] ? '✅' : '❌'}</span>
                  <span>{type}</span>
                </div>
              ))}
            </div>
          )}
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
