/* eslint-disable @typescript-eslint/no-explicit-any */
import clsx from 'classnames';
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import gfm from 'remark-gfm';
import markdown from 'remark-parse';
import { remarkToSlate } from 'remark-slate-transformer';
import type { BaseEditor, Descendant } from 'slate';
import {
  createEditor,
  Editor,
  Element as SlateElement,
  Node as SlateNode,
  Point,
  Range,
  Transforms,
} from 'slate';
import { withHistory } from 'slate-history';
import { Editable, ReactEditor, Slate, withReact } from 'slate-react';
import { unified } from 'unified';
import { fetchFileContent } from '../api/fetch-file-content-ky.api';

// import type { BulletedListElement } from './custom-types';

const processor = unified()
  .use(markdown)
  .use(gfm)
  .use(remarkToSlate, {
    // If you use TypeScript, install `@types/mdast` for autocomplete.
    overrides: {
      // This overrides `type: "heading"` builder of remarkToSlate
      heading: (node, next) => ({
        type: `h${node.depth}`,
        // You have to call next if the node have children
        children: next(node.children),
      }),
      // Unknown type from community plugins can be handled
    },
  });

export type BulletedListElement = {
  type: 'bulleted-list';
  align?: string;
  children: Descendant[];
};

const initialValue: Descendant[] = [
  {
    type: 'paragraph',
    children: [
      {
        text: 'ha',
      },
    ],
  },
];

type IShortcutKey =
  | '*'
  | '-'
  | '+'
  | '1.'
  | '2.'
  | '3.'
  | '4.'
  | '5.'
  | '6.'
  | '>'
  | '#'
  | '##'
  | '###'
  | '####'
  | '#####'
  | '######';

const shortcutKeyMap: { [id: string]: string } = {
  '*': 'listItem',
  '-': 'listItem',
  '+': 'listItem',
  '>': 'blockquote',
  '#': 'h1',
  '##': 'h2',
  '###': 'h3',
  '####': 'h4',
  '#####': 'h5',
  '######': 'h6',
};

interface IEditorProps {
  path?: string;
}

const MarkdownShortcutsExample = ({ path }: IEditorProps) => {
  console.log(path);
  const [rawContent, setRawContent] = useState('');
  const renderElement = useCallback((props: any) => <Element {...props} />, []);
  const editor = useMemo(() => withShortcuts(withReact(withHistory(createEditor()))), []);

  useEffect(() => {
    path &&
      fetchFileContent(path).then((res) => {
        setRawContent(res.content);
      });
  }, [path]);
  const handleDOMBeforeInput = useCallback(() => {
    queueMicrotask(() => {
      const pendingDiffs = ReactEditor.androidPendingDiffs(editor);

      const scheduleFlush = pendingDiffs?.some(({ diff, path }) => {
        if (!diff.text.endsWith(' ')) {
          return false;
        }

        const { text } = SlateNode.leaf(editor, path);
        const beforeText = text.slice(0, diff.start) + diff.text.slice(0, -1);
        if (!(beforeText in shortcutKeyMap)) {
          return;
        }

        const blockEntry = Editor.above(editor, {
          at: path,
          match: (n) => Editor.isBlock(editor, n),
        });
        if (!blockEntry) {
          return false;
        }

        const [, blockPath] = blockEntry;
        return Editor.isStart(editor, Editor.start(editor, path), blockPath);
      });

      if (scheduleFlush) {
        ReactEditor.androidScheduleFlush(editor);
      }
    });
  }, [editor]);

  const value: any = rawContent ? processor.processSync(rawContent).result : initialValue;
  editor.children = value; // <--- This line does the trick
  return (
    <article className="w-[48rem] m-auto prose">
      <Slate editor={editor as any} value={value as any}>
        <Editable
          className="!whitespace-normal"
          onDOMBeforeInput={handleDOMBeforeInput}
          renderElement={renderElement}
          placeholder="Write some markdown..."
          spellCheck
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </Slate>
    </article>
  );
};

const withShortcuts = (editor: BaseEditor) => {
  const { deleteBackward, insertText } = editor;

  editor.insertText = (text) => {
    const { selection } = editor;

    if (text.endsWith(' ') && selection && Range.isCollapsed(selection)) {
      const { anchor } = selection;
      const block = Editor.above(editor, {
        match: (n) => Editor.isBlock(editor, n),
      });
      const path = block ? block[1] : [];
      const start = Editor.start(editor, path);
      const range = { anchor, focus: start };
      const beforeText = (Editor.string(editor, range) + text.slice(0, -1)) as IShortcutKey;
      const type = shortcutKeyMap[beforeText];

      if (type) {
        Transforms.select(editor, range);

        if (!Range.isCollapsed(range)) {
          Transforms.delete(editor);
        }

        const newProperties: Partial<SlateElement> & { type: string } = {
          type,
        };
        Transforms.setNodes<SlateElement>(editor, newProperties, {
          match: (n) => Editor.isBlock(editor, n),
        });

        if (type === 'listItem') {
          const list: BulletedListElement = {
            type: 'bulleted-list',
            children: [],
          };
          Transforms.wrapNodes(editor, list, {
            match: (n) => !Editor.isEditor(n) && SlateElement.isElement(n) && n.type === 'listItem',
          });
        }

        return;
      }
    }

    insertText(text);
  };

  editor.deleteBackward = (...args) => {
    const { selection } = editor;

    if (selection && Range.isCollapsed(selection)) {
      const match = Editor.above(editor, {
        match: (n) => Editor.isBlock(editor, n),
      });

      if (match) {
        const [block, path] = match;
        const start = Editor.start(editor, path);

        if (
          !Editor.isEditor(block) &&
          SlateElement.isElement(block) &&
          block.type !== 'paragraph' &&
          Point.equals(selection.anchor, start)
        ) {
          const newProperties: Partial<SlateElement> = {
            type: 'paragraph',
          };
          Transforms.setNodes(editor, newProperties);

          if (block.type === 'listItem') {
            Transforms.unwrapNodes(editor, {
              match: (n) =>
                !Editor.isEditor(n) && SlateElement.isElement(n) && n.type === 'bulleted-list',
              split: true,
            });
          }

          return;
        }
      }

      deleteBackward(...args);
    }
  };

  return editor;
};

const safeTag = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'del',
  'ins',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
];

const Element = ({ attributes, children, element }: any) => {
  // eslint-disable-next-line sonarjs/no-small-switch
  switch (element.type) {
    case 'html':
      console.log(element);
      return (
        <div>
          {element.children.map((child: any, index: number) => {
            return <div key={index} dangerouslySetInnerHTML={{ __html: child.text }} />;
          })}
        </div>
      );
    case 'paragraph':
      return (
        <p className="cursor-text" {...attributes}>
          {children.map((item: any, index: number) => {
            return (
              <span
                key={index}
                className={clsx({
                  'text-red-400 p-[2px] rounded bg-gray-200': item.props.text?.inlineCode,
                })}
              >
                {item}
              </span>
            );
          })}
        </p>
      );
    case 'code':
      return (
        <pre className="cursor-text" {...attributes}>
          {children}
        </pre>
      );
    case 'list':
      if (element.ordered) {
        return (
          <ol className="cursor-text" {...attributes}>
            {children}
          </ol>
        );
      }
      return (
        <ul className="cursor-text" {...attributes}>
          {children}
        </ul>
      );
    case 'listItem':
      return (
        <li className="cursor-text" {...attributes}>
          {children}
        </li>
      );
    case 'link':
      // eslint-disable-next-line no-case-declarations
      const { url } = element;
      return (
        <a href={url} className="cursor-text" {...attributes}>
          {children}
        </a>
      );
    default:
      if (safeTag.includes(element.type)) {
        return createElement(
          element.type,
          {
            className: 'cursor-text',
            ...attributes,
          },
          ...children
        );
      }
      return (
        <p className="cursor-text" {...attributes}>
          {children}
        </p>
      );
  }
};

export default MarkdownShortcutsExample;
