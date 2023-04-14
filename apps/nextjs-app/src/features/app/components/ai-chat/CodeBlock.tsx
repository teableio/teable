import { useToast } from '@teable-group/sdk';
import CopyIcon from '@teable-group/ui-lib/icons/app/copy.svg';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import type { IChat } from './type';

interface Props {
  chat: IChat;
  language: string;
  value: string;
  onExecute(text?: string): void;
}

export const checkStatementIsSelect = (statement: string) => {
  return statement.toUpperCase().trim().startsWith('SELECT');
};

export const CodeBlock: React.FC<Props> = ({ language, value, chat, onExecute }) => {
  const toast = useToast();
  const showExecuteButton = language.toUpperCase() === 'AI';

  const copyToClipboard = () => {
    console.log('copy!');
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      toast.open('Failed to copy to clipboard');
      return;
    }
    navigator.clipboard.writeText(value).then(() => {
      toast.open('Copied to clipboard');
    });
  };

  const handleExecuteQuery = () => {
    onExecute(value);
  };

  return (
    <div className="w-full max-w-full relative font-sans text-sm">
      <div className="flex items-center justify-between py-2 px-4">
        <span className="text-xs text-white font-mono">{language}</span>
        <div className="flex items-center space-x-2">
          <button
            className="flex justify-center items-center rounded bg-none w-6 h-6 p-1 text-xs text-white opacity-70 hover:opacity-100 bg-gray-500"
            onClick={copyToClipboard}
          >
            <CopyIcon />
          </button>
          {showExecuteButton && (
            <button
              className="flex justify-center items-center rounded bg-none w-6 h-6 p-1 text-xs text-white opacity-70 hover:opacity-100 bg-gray-500"
              onClick={handleExecuteQuery}
            >
              ▶️
            </button>
          )}
        </div>
      </div>
      <SyntaxHighlighter
        language={language.toLowerCase()}
        style={oneDark}
        customStyle={{ margin: 0 }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};
