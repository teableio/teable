import { useTheme } from '@teable/next-themes';
import { useEffect } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

export const MarkdownPreview = (props: { children?: string }) => {
  const { resolvedTheme: currentTheme } = useTheme();

  useEffect(() => {
    if (currentTheme === 'dark') {
      require('github-markdown-css/github-markdown-dark.css');
    } else {
      require('github-markdown-css/github-markdown-light.css');
    }
  }, [currentTheme]);

  return (
    <Markdown
      className="markdown-body px-3 py-2 !text-sm"
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
    >
      {props.children}
    </Markdown>
  );
};
