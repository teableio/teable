/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import type { UseChatHelpers } from '@ai-sdk/react';
import { Check, ChevronDown } from '@teable/icons';
import { McpToolInvocationName } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@teable/ui-lib/shadcn';
import { isEqual } from 'lodash';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { memo, useMemo, useState } from 'react';
import { Markdown } from './Markdown';

interface IToolMessagePart {
  id: string;
  part: UseChatHelpers['messages'][number]['parts'][number] & {
    type: 'tool-invocation';
  };
}

export const PureToolMessagePart = ({ id, part }: IToolMessagePart) => {
  const { toolInvocation } = part;

  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation(['table']);

  const toolName = useMemo(() => {
    switch (toolInvocation.toolName) {
      case McpToolInvocationName.GetTableFields:
        return t('aiChat.tool.getTableFields');
      case McpToolInvocationName.GetTablesMeta:
        return t('aiChat.tool.getTablesMeta');
      case McpToolInvocationName.SqlQuery:
        return t('aiChat.tool.sqlQuery');
      default:
        return toolInvocation.toolName;
    }
  }, [toolInvocation.toolName, t]);

  const isResult = toolInvocation.state === 'result';

  return (
    <Accordion
      type="single"
      collapsible
      value={isExpanded ? 'expanded' : 'collapsed'}
      onValueChange={(value) => {
        setIsExpanded(value === 'expanded');
      }}
      className="w-full"
    >
      <AccordionItem
        value="expanded"
        className="font-sm rounded-lg border bg-neutral-50 px-2 dark:bg-neutral-900/80"
      >
        <AccordionTrigger
          headerClassName="flex-1"
          hiddenChevron
          className="gap-1 py-2 text-xs font-normal text-muted-foreground hover:no-underline"
        >
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <div>{toolName}</div>
          </div>
          <div className="flex items-center gap-2">
            {isResult ? <Check className="size-4 text-green-500" /> : <Spin className="size-4" />}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-2 px-3 text-muted-foreground">
            <div className="space-y-1">
              <div className="text-sm">{t('table:aiChat.tool.args')}: </div>
              <ContentRenderer id={id} content={JSON.stringify(toolInvocation.args, null, 2)} />
            </div>
            {isResult && (
              <div className="space-y-1">
                <div className="text-sm">{t('table:aiChat.tool.result')}: </div>
                <ToolsResultRenderer id={id} toolInvocation={toolInvocation} />
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

const PureToolsResultRenderer = ({
  id,
  toolInvocation,
}: {
  id: string;
  toolInvocation: IToolMessagePart['part']['toolInvocation'] & { state: 'result' };
}) => {
  const result = toolInvocation.result?.['content']?.[0]?.text;

  const content = useMemo(() => {
    switch (toolInvocation.toolName) {
      case McpToolInvocationName.SqlQuery: {
        let res = result;
        try {
          res = JSON.stringify(JSON.parse(result), null, 2);
        } catch (error) {
          console.error(error);
        }
        return res;
      }
      case McpToolInvocationName.GetTableFields:
      case McpToolInvocationName.GetTablesMeta:
        return result;
      default:
        return JSON.stringify(toolInvocation.result, null, 2);
    }
  }, [result, toolInvocation.result, toolInvocation.toolName]);

  return <ContentRenderer id={id} content={content} />;
};

const ToolsResultRenderer = memo(PureToolsResultRenderer, (prev, next) => {
  if (prev.id !== next.id) return false;
  if (isEqual(prev.toolInvocation, next.toolInvocation)) return true;
  return false;
});

const ContentRenderer = ({ id, content }: { id: string; content: string }) => {
  return (
    <Markdown
      id={id}
      className="p-0"
      components={{
        pre(props) {
          const { children, ...rest } = props;
          return (
            <pre
              {...rest}
              style={{
                padding: 0,
              }}
            >
              {children}
            </pre>
          );
        },
      }}
    >{`\`\`\`json\n${content}`}</Markdown>
  );
};

export const ToolMessagePart = memo(PureToolMessagePart, (prev, next) => {
  return isEqual(prev.part, next.part);
});
