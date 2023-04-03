import UserIcon from '@teable-group/ui-lib/icons/app/user.svg';
import dayjs from 'dayjs';
import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { IMessage } from 'store/message';
import { useUserStore } from 'store/user';
import { CodeBlock } from './CodeBlock';

interface Props {
  message: IMessage;
}

export const MessageView: React.FC<Props> = ({ message }) => {
  const userStore = useUserStore();
  const isCurrentUser = message.creatorId === userStore.currentUser.id;
  return (
    <div
      className={`group w-full max-w-full flex flex-row justify-start items-start my-4 ${
        isCurrentUser ? 'justify-end pl-8 sm:pl-24' : 'pr-8 sm:pr-24'
      }`}
    >
      {isCurrentUser ? (
        <>
          <div className="w-auto max-w-full bg-indigo-600 text-white px-4 py-2 rounded-lg whitespace-pre-wrap">
            {message.content}
          </div>
          <div className="w-10 h-10 p-1 border rounded-full flex justify-center items-center ml-2 shrink-0">
            <UserIcon />
          </div>
        </>
      ) : (
        <>
          <div className="w-auto max-w-[calc(100%-4rem)] flex flex-col justify-start items-start">
            <ReactMarkdown
              className="w-auto max-w-full bg-base-300 px-4 py-2 rounded-lg prose prose-neutral"
              remarkPlugins={[remarkGfm]}
              components={{
                pre({ node, className, children, ...props }) {
                  const child = children[0] as ReactElement;
                  const match = /language-(\w+)/.exec(child.props.className || '');
                  const language = match ? match[1] : 'text';
                  return (
                    <pre className={`${className || ''} w-full p-0 my-1`} {...props}>
                      <CodeBlock
                        key={Math.random()}
                        language={language || 'text'}
                        value={String(child.props.children).replace(/\n$/, '')}
                        {...props}
                      />
                    </pre>
                  );
                },
                code({ children }) {
                  return <code className="px-0">`{children}`</code>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
            <span className="self-end text-sm text-gray-400 pt-1 pr-1">
              {dayjs(message.createdAt).format('lll')}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
