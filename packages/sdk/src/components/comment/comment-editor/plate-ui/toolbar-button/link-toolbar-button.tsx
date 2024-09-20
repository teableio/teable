import { Link } from '@teable/icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Button } from '@teable/ui-lib';
import { focusEditor, useEditorRef } from '@udecode/plate-common/react';
import { triggerFloatingLink } from '@udecode/plate-link/react';
import { useTranslation } from '../../../../../context/app/i18n';

export const LinkToolbarButton = () => {
  const { t } = useTranslation();
  const editor = useEditorRef();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={'xs'}
            onClick={() => {
              triggerFloatingLink(editor, { focused: true });
              focusEditor(editor);
            }}
          >
            <Link />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('comment.toolbar.link')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
