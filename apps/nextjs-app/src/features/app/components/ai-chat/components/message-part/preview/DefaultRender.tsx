import { McpToolInvocationName } from '@teable/openapi';
import { isEqual } from 'lodash';
import { useTranslation } from 'next-i18next';
import { memo, useMemo } from 'react';
import { Markdown } from '../Markdown';
import type { IToolMessagePart } from '../ToolMessagePart';

interface IDefaultRenderProps {
  id: string;
  toolInvocation: IToolMessagePart['part']['toolInvocation'] & { state: 'result' };
}

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
              className="bg-card"
              style={{
                padding: 0,
                backgroundColor: 'var(--card-background)',
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
      case McpToolInvocationName.RunScripts:
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

export const DefaultRender = (props: IDefaultRenderProps) => {
  const { id, toolInvocation } = props;
  const { t } = useTranslation(['table']);
  const isResult = toolInvocation.state === 'result';

  return (
    <>
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
    </>
  );
};
