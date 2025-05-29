'use client';

import type { DropdownMenuProps } from '@teable/ui-lib';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  sonner,
} from '@teable/ui-lib';

import { isUrl } from '@udecode/plate';
import { useEditorRef } from '@udecode/plate/react';
import {
  AudioPlugin,
  FilePlugin,
  ImagePlugin,
  PlaceholderPlugin,
  VideoPlugin,
} from '@udecode/plate-media/react';
import { AudioLinesIcon, FileUpIcon, FilmIcon, ImageIcon } from 'lucide-react';
import * as React from 'react';

import { useFilePicker } from 'use-file-picker';
import { useTranslation } from '../../../context/app/i18n';
import { Input } from './input';

import {
  ToolbarSplitButton,
  ToolbarSplitButtonPrimary,
  // ToolbarSplitButtonSecondary,
} from './toolbar';

const { toast } = sonner;

const MEDIA_CONFIG: Record<
  string,
  {
    accept: string[];
    icon: React.ReactNode;
    title: string;
    tooltip: string;
  }
> = {
  [AudioPlugin.key]: {
    accept: ['audio/*'],
    icon: <AudioLinesIcon className="size-4" />,
    title: 'Insert Audio',
    tooltip: 'Audio',
  },
  [FilePlugin.key]: {
    accept: ['*'],
    icon: <FileUpIcon className="size-4" />,
    title: 'Insert File',
    tooltip: 'File',
  },
  [ImagePlugin.key]: {
    accept: ['image/*'],
    icon: <ImageIcon className="size-3.5" />,
    title: 'Insert Image',
    tooltip: 'Image',
  },
  [VideoPlugin.key]: {
    accept: ['video/*'],
    icon: <FilmIcon className="size-4" />,
    title: 'Insert Video',
    tooltip: 'Video',
  },
};

export function MediaToolbarButton({
  nodeType,
  // ...props
}: DropdownMenuProps & { nodeType: string }) {
  const currentConfig = MEDIA_CONFIG[nodeType];

  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { openFilePicker } = useFilePicker({
    accept: currentConfig.accept,
    multiple: false,
    onFilesSelected: ({ plainFiles: updatedFiles }) => {
      editor.getTransforms(PlaceholderPlugin).insert.media(updatedFiles);
    },
  });

  const { t } = useTranslation();

  return (
    <>
      <ToolbarSplitButton
        size="xs"
        onClick={() => {
          openFilePicker();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        pressed={open}
        tooltip={t('comment.toolbar.image')}
      >
        <ToolbarSplitButtonPrimary className="rounded-md" size="xs">
          {currentConfig.icon}
        </ToolbarSplitButtonPrimary>

        {/* <DropdownMenu open={open} onOpenChange={setOpen} modal={false} {...props}>
          <DropdownMenuTrigger asChild>
            <ToolbarSplitButtonSecondary />
          </DropdownMenuTrigger>

          <DropdownMenuContent onClick={(e) => e.stopPropagation()} align="start" alignOffset={-32}>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => openFilePicker()}>
                {currentConfig.icon}
                Upload from computer
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
                <LinkIcon />
                Insert via URL
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu> */}
      </ToolbarSplitButton>

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(value) => {
          setDialogOpen(value);
        }}
      >
        <AlertDialogContent className="gap-6">
          <MediaUrlDialogContent
            currentConfig={currentConfig}
            nodeType={nodeType}
            setOpen={setDialogOpen}
          />
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MediaUrlDialogContent({
  currentConfig,
  nodeType,
  setOpen,
}: {
  currentConfig: (typeof MEDIA_CONFIG)[string];
  nodeType: string;
  setOpen: (value: boolean) => void;
}) {
  const editor = useEditorRef();
  const [url, setUrl] = React.useState('');

  const embedMedia = React.useCallback(() => {
    if (!isUrl(url)) return toast('Invalid URL');

    setOpen(false);
    editor.tf.insertNodes({
      children: [{ text: '' }],
      name: nodeType === FilePlugin.key ? url.split('/').pop() : undefined,
      type: nodeType,
      url,
    });
  }, [url, editor, nodeType, setOpen]);

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{currentConfig.title}</AlertDialogTitle>
      </AlertDialogHeader>

      <AlertDialogDescription className="group relative w-full">
        <label
          className="absolute top-1/2 block -translate-y-1/2 cursor-text px-1 text-sm text-muted-foreground/70 transition-all group-focus-within:pointer-events-none group-focus-within:top-0 group-focus-within:cursor-default group-focus-within:text-xs group-focus-within:font-medium group-focus-within:text-foreground has-[+input:not(:placeholder-shown)]:pointer-events-none has-[+input:not(:placeholder-shown)]:top-0 has-[+input:not(:placeholder-shown)]:cursor-default has-[+input:not(:placeholder-shown)]:text-xs has-[+input:not(:placeholder-shown)]:font-medium has-[+input:not(:placeholder-shown)]:text-foreground"
          htmlFor="url"
        >
          <span className="inline-flex bg-background px-2">URL</span>
        </label>
        <Input
          id="url"
          className="w-full"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') embedMedia();
          }}
          placeholder=""
          type="url"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </AlertDialogDescription>

      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={(e) => {
            e.preventDefault();
            embedMedia();
          }}
        >
          Accept
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
