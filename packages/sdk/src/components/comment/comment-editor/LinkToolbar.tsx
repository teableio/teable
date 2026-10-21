import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { Button, Separator } from '@teable/ui-lib';
import type { Editor } from '@tiptap/core';
import { getMarkRange } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ExternalLink, Link, Text, Unlink } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../../context/app/i18n';

/** Bare domains get https; any scheme other than http(s)/mailto (javascript:, data:) is refused. */
export const normalizeHref = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  if (/^(?:https?:|mailto:)/i.test(value)) return value;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  return `https://${value}`;
};

const linkRange = (editor: Editor) => {
  const { $from, from, to } = editor.state.selection;
  return getMarkRange($from, editor.schema.marks.link) ?? { from, to };
};

interface ILinkToolbarProps {
  editor: Editor;
  container: HTMLElement;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

const LinkForm = (props: { editor: Editor; onClose: () => void }) => {
  const { editor, onClose } = props;
  const { t } = useTranslation();
  const formRef = useRef<HTMLDivElement>(null);
  const [initial] = useState(() => {
    const range = linkRange(editor);
    return {
      range,
      url: (editor.getAttributes('link').href as string | undefined) ?? '',
      text: editor.state.doc.textBetween(range.from, range.to, ' '),
    };
  });
  const [url, setUrl] = useState(initial.url);
  const [text, setText] = useState(initial.text);
  const applyRef = useRef<() => void>(() => undefined);

  applyRef.current = () => {
    const href = normalizeHref(url);
    const chain = editor.chain().focus();
    if (href) {
      chain.insertContentAt(initial.range, {
        type: 'text',
        text: text || href,
        marks: [{ type: 'link', attrs: { href } }],
      });
    } else if (!url.trim() && initial.url) {
      // clearing the url of an existing link unlinks it
      chain.setTextSelection(initial.range).unsetLink();
    }
    chain.run();
    onClose();
  };

  // clicking away keeps what was typed, as Enter would
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) applyRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyRef.current();
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      editor.commands.focus();
    }
  };

  const inputClassName =
    'flex h-7 w-full rounded-md border-none bg-transparent px-1.5 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none';

  return (
    <div ref={formRef} className="flex w-[330px] flex-col">
      <div className="flex items-center">
        <Link className="mx-2 size-4 shrink-0 text-muted-foreground" />
        <input
          className={inputClassName}
          placeholder={t('comment.floatToolbar.enterUrl')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onKeyDown}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </div>
      <Separator className="my-1" />
      <div className="flex items-center">
        <Text className="mx-2 size-4 shrink-0 text-muted-foreground" />
        <input
          className={inputClassName}
          placeholder={t('comment.floatToolbar.linkText')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
};

/**
 * The floating box for links: the url/text form while inserting or editing
 * (Mod+K or "Edit link"), otherwise edit/open/unlink for the link under the caret.
 */
export const LinkToolbar = (props: ILinkToolbarProps) => {
  const { editor, container, editing, onEditingChange } = props;
  const { t } = useTranslation();
  const floatingRef = useRef<HTMLDivElement>(null);
  const { isLink, focused, from, to, href } = useEditorState({
    editor,
    selector: ({ editor }) => ({
      isLink: editor.isActive('link'),
      focused: editor.isFocused,
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      href: editor.getAttributes('link').href as string | undefined,
    }),
  });
  const visible = editing || (focused && isLink && !!href);

  useLayoutEffect(() => {
    const floating = floatingRef.current;
    if (!visible || !floating) return;
    const reference = {
      contextElement: editor.view.dom,
      // read the live selection: autoUpdate re-measures after the document has moved on
      getBoundingClientRect: () => {
        const { from, to } = editor.state.selection;
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        return new DOMRect(start.left, start.top, end.right - start.left, end.bottom - start.top);
      },
    };
    return autoUpdate(reference, floating, () => {
      computePosition(reference, floating, {
        placement: 'bottom-start',
        middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        Object.assign(floating.style, { left: `${x}px`, top: `${y}px` });
      });
    });
  }, [editor, visible, from, to]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={floatingRef}
      style={{ left: 0, top: 0 }}
      className="absolute z-50 w-max rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {editing ? (
        <LinkForm
          // a new caret position is a new link to edit
          key={`${from}-${to}`}
          editor={editor}
          onClose={() => onEditingChange(false)}
        />
      ) : (
        <div
          role="toolbar"
          className="flex items-center gap-0.5"
          // keep the caret on the link while using the buttons
          onMouseDown={(e) => e.preventDefault()}
        >
          <Button size="xs" variant="ghost" onClick={() => onEditingChange(true)}>
            {t('comment.floatToolbar.editLink')}
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Button size="icon-xs" variant="ghost" asChild>
            <a href={href} target="_blank" rel="noreferrer" aria-label={href}>
              <ExternalLink className="size-4" />
            </a>
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
          >
            <Unlink className="size-4" />
          </Button>
        </div>
      )}
    </div>,
    container
  );
};
