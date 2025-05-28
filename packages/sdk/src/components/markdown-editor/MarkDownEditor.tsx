import { Plate, usePlateEditor } from '@udecode/plate/react';
import { useEffect, useState } from 'react';
import { EditorContainer } from './EditorContainer';
import { MarkdownPreview } from './MarkDownPreview';

interface IMarkDownEditorProps {
  value?: string;
  autoFocusLastNode?: boolean;
  onChange: (value: string) => void;
}

export const MarkDownEditor = (props: IMarkDownEditorProps) => {
  const { value, onChange, autoFocusLastNode } = props;
  const [markdownValue, setMarkdownValue] = useState(value || '');

  const markdownEditor = usePlateEditor({
    plugins: [],
    value: [{ children: [{ text: markdownValue }], type: 'p' }],
  });

  useEffect(() => {
    if (autoFocusLastNode) {
      markdownEditor.tf.focus();
      const lastNodeEntry = markdownEditor.api.last([]);
      if (lastNodeEntry) {
        const [, lastPath] = lastNodeEntry;
        const end = markdownEditor.api.end(lastPath);
        markdownEditor.tf.select(end);
      }
    }
  }, [autoFocusLastNode, markdownEditor]);

  return (
    <div className="flex flex-1 gap-0.5 overflow-hidden rounded-sm border">
      <Plate
        onValueChange={() => {
          const value = markdownEditor.children
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((node: any) => markdownEditor.api.string(node))
            .join('\n');
          setMarkdownValue(value);
          onChange(value);
        }}
        editor={markdownEditor}
      >
        <EditorContainer variant={'ghost'} className="size-full rounded-none bg-secondary" />
      </Plate>

      <MarkdownPreview className="w-1/2 overflow-auto">{markdownValue}</MarkdownPreview>
    </div>
  );
};
