import UserIcon from '@teable/ui-lib/icons/app/user.svg';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import type { ReactElement } from 'react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { IMessage } from 'store/message';
import { useUserStore } from 'store/user';
import { CodeBlock } from './CodeBlock';
import { createAISyntaxParser } from './createAISyntaxParser';
import { ProcessBar } from './ProcessBar';
import type { IChat } from './type';
dayjs.extend(localizedFormat);

interface Props {
  chat: IChat;
  message: IMessage;
}

export const MessageView: React.FC<Props> = ({ message, chat }) => {
  const userStore = useUserStore();
  const isCurrentUser = message.creatorId === userStore.currentUser.id;
  const isAiCode = message.content.includes('```ai');
  const [debugAI, setDebugAI] = useState(false);
  const regex = /```ai\n([\s\S]*?)(?:(```)|$)/;
  const match = message.content.match(regex);
  const [parser] = useState(() => createAISyntaxParser());
  const [parsedResult, setParsedResult] = useState<unknown>();
  if (match) {
    const content = match[1];
    parser(content, (result) => {
      if (!result) {
        return;
      }
      console.log('parseResult： ', result);
      setParsedResult(result);
    });
  }

  const Element = () => {
    if (isAiCode && !debugAI) {
      let done = false;
      if (match) {
        done = Boolean(match[2]);
      }
      return (
        <ProcessBar
          type={message.type}
          done={done}
          onClick={() => setDebugAI(true)}
          parsedResult={parsedResult}
        />
      );
    }

    return (
      <ReactMarkdown
        className="bg-base-300 prose prose-slate w-auto max-w-full rounded-lg px-2 py-1 text-sm"
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ node, className, children, ...props }) {
            const child = children as ReactElement;
            const match = /language-(\w+)/.exec(child.props.className || '');
            const language = match ? match[1] : 'text';
            const strValue = String(child.props.children);
            return (
              <pre className={`${className || ''} my-1 w-full p-0`} {...props}>
                <CodeBlock
                  chat={chat}
                  language={language || 'text'}
                  value={strValue}
                  onExecute={() => setDebugAI(false)}
                  {...props}
                />
              </pre>
            );
          },
          code({ children, key }) {
            return (
              <code key={key} className="px-0">
                `{children}`
              </code>
            );
          },
        }}
      >
        {message.content}
      </ReactMarkdown>
    );
  };
  return (
    <div
      className={`group my-4 flex w-full max-w-full flex-row items-start justify-start ${
        isCurrentUser && 'justify-end'
      }`}
    >
      {isCurrentUser ? (
        <>
          <div className="w-auto max-w-full whitespace-pre-wrap rounded-lg bg-indigo-600 px-2 py-1 text-sm text-white">
            {message.content}
          </div>
          <div className="ml-2 flex size-8 shrink-0 items-center justify-center rounded-full border p-1">
            <UserIcon />
          </div>
        </>
      ) : (
        <>
          <div className="flex w-full flex-col items-start justify-start">
            {Element()}
            <span className="self-end pr-1 pt-1 text-xs">
              {dayjs(message.createdAt).format('lll')}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
