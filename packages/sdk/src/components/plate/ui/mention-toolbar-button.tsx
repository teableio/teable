'use client';

import { useEditorRef } from '@udecode/plate/react';
import { MentionInputPlugin } from '@udecode/plate-mention/react';
import { AtSignIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../../../context/app/i18n';
import { ToolbarButton } from './toolbar';

export function MentionToolbarButton(props: React.ComponentProps<typeof ToolbarButton>) {
  const editor = useEditorRef();
  const { t } = useTranslation();

  return (
    <ToolbarButton
      {...props}
      data-plate-focus
      tooltip={t('comment.toolbar.mention')}
      size={'xs'}
      onMouseDown={(e) => {
        // Use onMouseDown + preventDefault to prevent editor blur on desktop
        e.preventDefault();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();

        // Focus the editor and wait for selection to be established
        editor.tf.focus();

        // Use requestAnimationFrame to ensure focus/selection is ready (critical for mobile)
        requestAnimationFrame(() => {
          const selection = editor.selection;
          if (selection) {
            const { anchor } = selection;
            // If not at start of text, check previous character
            if (anchor.offset > 0) {
              const prevPoint = { path: anchor.path, offset: anchor.offset - 1 };
              const prevChar = editor.api.string({ anchor: prevPoint, focus: anchor });
              // If previous char is not space/empty, insert a space first
              if (prevChar && !/^\s$/.test(prevChar)) {
                editor.tf.insertText(' ');
              }
            }
          }

          // Directly insert mention_input node — bypasses the insertText trigger mechanism
          // This is more reliable on mobile where insertText('@') may not fire properly
          editor.tf.insertNodes({
            type: MentionInputPlugin.key,
            children: [{ text: '' }],
            trigger: '@',
          });
        });
      }}
    >
      <AtSignIcon className="size-3.5" />
    </ToolbarButton>
  );
}
