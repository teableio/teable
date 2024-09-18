import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

export const MarkdownPreview = (props: { children?: string }) => {
  return (
    <Markdown
      className="markdown-body !bg-background px-3 py-2 !text-sm !text-foreground"
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
    >
      {props.children}
    </Markdown>
  );
};
