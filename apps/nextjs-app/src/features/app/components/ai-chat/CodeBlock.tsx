import { useToast } from '@teable-group/sdk';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

interface Props {
  language: string;
  value: string;
}

export const checkStatementIsSelect = (statement: string) => {
  return statement.toUpperCase().trim().startsWith('SELECT');
};

export const CodeBlock: React.FC<Props> = ({ language, value }) => {
  // Only show execute button in the following situations:
  // * SQL code, and it is a SELECT statement;
  // * Connection setup;
  const toast = useToast();
  const showExecuteButton = language.toUpperCase() === 'SQL' && checkStatementIsSelect(value);
  const copyToClipboard = () => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      toast.open('Failed to copy to clipboard');
      return;
    }
    navigator.clipboard.writeText(value).then(() => {
      toast.open('Copied to clipboard');
    });
  };

  const handleExecuteQuery = () => {
    toast.open('Executing');
  };

  return (
    <div className="w-full max-w-full relative font-sans text-[16px]">
      <div className="flex items-center justify-between py-2 px-4">
        <span className="text-xs text-white font-mono">{language}</span>
        <div className="flex items-center space-x-2">
          <button
            className="flex justify-center items-center rounded bg-none w-6 h-6 p-1 text-xs text-white bg-gray-500 opacity-70 hover:opacity-100"
            onClick={copyToClipboard}
          >
            📃
          </button>
          {showExecuteButton && (
            <button
              className="flex justify-center items-center rounded bg-none w-6 h-6 p-1 text-xs text-white bg-gray-500 opacity-70 hover:opacity-100"
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
