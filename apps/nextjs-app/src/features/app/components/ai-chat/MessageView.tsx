import UserIcon from '@teable-group/ui-lib/icons/app/user.svg';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import type { ReactElement } from 'react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { IMessage } from 'store/message';
import { useUserStore } from 'store/user';
import { RenderBox } from '../render-box/RenderBox';
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
  const isOfficial = message.creatorId === 'teable';
  const [parser] = useState(() => createAISyntaxParser());
  const isAiCode = message.content.includes('```ai');
  const [debugAI, setDebugAI] = useState(false);
  const Element = () => {
    if (isAiCode && !debugAI) {
      const regex = /```ai\n([\s\S]*?)(?:(```)|$)/;
      const match = message.content.match(regex);
      let done = false;
      if (match) {
        const content = match[1];
        console.log(match);
        done = Boolean(match[2]);
        parser(content);
      }
      return <ProcessBar message={message} done={done} onClick={() => setDebugAI(true)} />;
    }

    if (isOfficial && message.code) {
      return <RenderBox code={message.code} />;
    }

    return (
      <ReactMarkdown
        className="w-auto max-w-full bg-base-300 px-2 py-1 rounded-lg prose prose-slate text-sm"
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ node, className, children, ...props }) {
            const child = children[0] as ReactElement;
            const match = /language-(\w+)/.exec(child.props.className || '');
            const language = match ? match[1] : 'text';
            const strValue = String(child.props.children);
            return (
              <pre className={`${className || ''} w-full p-0 my-1`} {...props}>
                <CodeBlock chat={chat} language={language || 'text'} value={strValue} {...props} />
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
      className={`group w-full max-w-full flex flex-row justify-start items-start my-4 ${
        isCurrentUser && 'justify-end'
      }`}
    >
      {isCurrentUser ? (
        <>
          <div className="w-auto max-w-full bg-indigo-600 text-white px-2 py-1 rounded-lg whitespace-pre-wrap text-sm">
            {message.content}
          </div>
          <div className="w-8 h-8 p-1 border rounded-full flex justify-center items-center ml-2 shrink-0">
            <UserIcon />
          </div>
        </>
      ) : (
        <>
          <div className="w-full flex flex-col justify-start items-start">
            {Element()}
            <span className="self-end text-xs pt-1 pr-1">
              {dayjs(message.createdAt).format('lll')}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
