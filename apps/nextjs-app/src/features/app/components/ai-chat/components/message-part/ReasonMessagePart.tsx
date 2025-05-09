import type { UseChatHelpers } from '@ai-sdk/react';
import { ChevronDown, ChevronRight } from '@teable/icons';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';

interface IReasonMessagePart {
  isLoading?: boolean;
  isLastPart?: boolean;
  part: UseChatHelpers['messages'][number]['parts'][number] & {
    type: 'reasoning';
  };
}

export const ReasonMessagePart = ({ part, isLoading, isLastPart }: IReasonMessagePart) => {
  const { t } = useTranslation(['table']);
  const [isExpanded, setIsExpanded] = useState<boolean>();
  const [defaultExpanded, setDefaultExpanded] = useState<boolean>(false);
  const reasoning = part.reasoning;
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isLoading && isLastPart) {
      setDefaultExpanded(true);
      timer = setTimeout(() => {
        setDefaultExpanded(false);
      }, 1000);
    }
    return () => {
      timer && clearTimeout(timer);
    };
  }, [isLastPart, isLoading, reasoning]);

  const factIsExpanded = typeof isExpanded === 'boolean' ? isExpanded : defaultExpanded;

  return (
    <Accordion
      type="single"
      collapsible
      value={factIsExpanded ? 'expanded' : 'collapsed'}
      onValueChange={(value) => {
        setIsExpanded(value === 'expanded');
      }}
    >
      <AccordionItem value="expanded" className="border-none">
        <AccordionTrigger hiddenChevron className="p-0 hover:no-underline">
          <div
            className={cn(
              'font-xs flex items-center gap-0.5 py-1 font-normal text-muted-foreground hover:text-foreground',
              {
                'text-foreground': factIsExpanded,
              }
            )}
          >
            {factIsExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <div>{t('table:aiChat.thought')}</div>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="text-[13px] text-gray-500">{reasoning}</div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
