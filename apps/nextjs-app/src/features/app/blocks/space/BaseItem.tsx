/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { hasPermission } from '@teable/core';
import { ChevronDown, ChevronRight, Database, MoreHorizontal } from '@teable/icons';
import type { IGetBaseVo } from '@teable/openapi';
import { PinType } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Avatar, AvatarFallback, AvatarImage, Button, cn, Input } from '@teable/ui-lib/shadcn';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useClickAway } from 'react-use';
import { spaceConfig } from '@/features/i18n/space.config';
import { Emoji } from '../../components/emoji/Emoji';
import { EmojiPicker } from '../../components/emoji/EmojiPicker';
import { BaseActionTrigger } from './component/BaseActionTrigger';
import { StarButton } from './space-side-bar/StarButton';

export interface IBaseItemProps {
  base: IGetBaseVo;
  lastVisitTime?: string;
  className?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onEnterBase?: () => void;
  onUpdate?: (data: { name?: string; icon?: string }) => void;
  onDelete?: (permanent?: boolean) => void;
}

export const BaseItem: FC<IBaseItemProps> = (props) => {
  const {
    base,
    lastVisitTime,
    className,
    isExpanded = false,
    onToggleExpand,
    onEnterBase,
    onUpdate,
    onDelete,
  } = props;
  const dayjs = useLanDayjs();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingValue, setEditingValue] = useState('');

  const hasUpdatePermission = !base.restrictedAuthority && hasPermission(base.role, 'base|update');
  const hasDeletePermission = !base.restrictedAuthority && hasPermission(base.role, 'base|delete');
  const hasMovePermission = !base.restrictedAuthority && hasPermission(base.role, 'space|create');

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  const startEditing = () => {
    setIsEditing(true);
    setEditingValue(base.name);
  };

  const finishEditing = () => {
    if (!isEditing) return;
    if (editingValue && editingValue !== base.name) {
      onUpdate?.({ name: editingValue });
    }
    setIsEditing(false);
    setEditingValue('');
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [isEditing]);

  useClickAway(inputRef, finishEditing);

  return (
    <div
      className={cn('group flex h-12 items-center cursor-pointer hover:bg-accent', className)}
      onClick={() => onToggleExpand?.()}
    >
      <Button
        variant="ghost"
        size="xs"
        className="size-4 shrink-0 p-0"
        onClick={(e) => {
          stopPropagation(e);
          onToggleExpand?.();
        }}
      >
        {isExpanded ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </Button>
      {/* Name Column */}
      <div className="flex h-8 w-full flex-1 items-center gap-2 overflow-hidden px-2">
        <div
          className="flex items-center"
          onClick={(e) => hasUpdatePermission && stopPropagation(e)}
        >
          <EmojiPicker
            className="flex items-center justify-center"
            disabled={!hasUpdatePermission || isEditing}
            onChange={(icon) => onUpdate?.({ icon })}
          >
            {base.icon ? <Emoji emoji={base.icon} size="1rem" /> : <Database className="size-4" />}
          </EmojiPicker>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isEditing ? (
            <Input
              ref={inputRef}
              className="size-full"
              value={editingValue}
              onClick={stopPropagation}
              onMouseDown={stopPropagation}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={finishEditing}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') finishEditing();
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setEditingValue('');
                }
              }}
            />
          ) : (
            <>
              <p
                className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
                title={base.name}
              >
                {base.name}
              </p>
              <StarButton
                className="size-4 shrink-0 opacity-0 group-hover:opacity-100"
                id={base.id}
                type={PinType.Base}
              />
            </>
          )}
        </div>
      </div>

      {/* Creator Column */}
      <div className="flex w-40 shrink-0 items-center gap-2">
        <Avatar className="size-6 border">
          <AvatarImage src={base.createdUser?.avatar ?? ''} />
          <AvatarFallback className="text-xs">{base.createdUser?.name?.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <span className="truncate text-xs" title={base.createdUser?.name}>
          {base.createdUser?.name}
        </span>
      </div>

      {/* Last Opened Column */}
      <div className="w-40 shrink-0 text-xs lg:w-60">
        {lastVisitTime ? dayjs(lastVisitTime).fromNow() : '-'}
      </div>

      {/* Actions Column */}
      <div
        className="absolute right-0 flex shrink-0 items-center justify-end gap-2 bg-accent px-4 opacity-0 group-hover:opacity-100"
        onClick={stopPropagation}
        onMouseDown={stopPropagation}
      >
        <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={onEnterBase}>
          <ArrowRight className="size-4" />
          {t('space:baseList.enter')}
        </Button>

        <BaseActionTrigger
          base={base}
          showRename={hasUpdatePermission}
          showDuplicate={hasUpdatePermission}
          showDelete={hasDeletePermission}
          showExport={hasUpdatePermission}
          showMove={hasMovePermission}
          onDelete={onDelete}
          onRename={startEditing}
        >
          <Button variant="outline" size="xs" className="size-7 p-0">
            <MoreHorizontal className="size-4" />
          </Button>
        </BaseActionTrigger>
      </div>
    </div>
  );
};
