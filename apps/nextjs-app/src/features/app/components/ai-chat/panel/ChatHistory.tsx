/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-autofocus */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Trash2, X } from '@teable/icons';
import { chatDelete, chatRename, type IChatHistoryItem } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
} from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useChatContext } from '../context/useChatContext';
import { useChatHistory } from '../hooks/useChatHistory';

export const ChatHistory = ({
  baseId,
  children,
}: {
  baseId: string;
  children: React.ReactNode;
}) => {
  const chatHistory = useChatHistory(baseId);
  const { setActiveChatId } = useChatContext();
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation(['table', 'common']);

  const { mutate: chatRenameMutation } = useMutation({
    mutationFn: ({ chatId, name }: { chatId: string; name: string }) =>
      chatRename(baseId, chatId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.chatHistory(baseId) });
      handleCancelEdit();
    },
  });

  const { mutate: chatDeleteMutation } = useMutation({
    mutationFn: (chatId: string) => chatDelete(baseId, chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.chatHistory(baseId) });
    },
  });

  const groupedHistory = useMemo(() => {
    return chatHistory
      ?.filter((chat) => chat.name.toLowerCase().includes(searchValue.toLowerCase()))
      .reduce(
        (acc, chat) => {
          const chatDate = dayjs(chat.createdTime);
          const now = dayjs(new Date());
          const diffDays = now.diff(chatDate, 'day');

          let group = '';
          if (diffDays === 0) {
            group = t('table:aiChat.timeGroup.today');
          } else if (diffDays <= 7) {
            group = t('table:aiChat.timeGroup.oneWeek');
          } else if (diffDays <= 14) {
            group = t('table:aiChat.timeGroup.twoWeek');
          } else if (diffDays <= 30) {
            group = t('table:aiChat.timeGroup.oneMonth');
          } else {
            group = t('table:aiChat.timeGroup.other');
          }

          if (!acc[group]) {
            acc[group] = [];
          }
          acc[group].push(chat);
          return acc;
        },
        {} as Record<string, typeof chatHistory>
      );
  }, [chatHistory, searchValue, t]);

  if (!groupedHistory) {
    return null;
  }

  const handleEditChat = (chat: IChatHistoryItem) => {
    setEditingChatId(chat.id);
    setEditValue(chat.name);
  };

  const handleCancelEdit = () => {
    setEditingChatId(null);
    setEditValue('');
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0 py-0.5">
        <Input
          placeholder={t('common:actions.search')}
          className="w-full border-none px-3 text-[13px] shadow-none focus-visible:ring-0"
          onChange={(e) => setSearchValue(e.target.value)}
          autoFocus
        />
        <ScrollArea className="h-[350px]">
          {Object.entries(groupedHistory).map(
            ([group, items], index) =>
              items.length > 0 && (
                <div
                  key={group}
                  className={cn({
                    'border-t pt-1 mt-1': index !== 0,
                  })}
                >
                  <div className="px-3 py-1 text-xs text-muted-foreground">{group}</div>
                  {items.map((chat) => (
                    <ChatHistoryItem
                      key={chat.id}
                      chat={chat}
                      editValue={editValue}
                      editingChatId={editingChatId}
                      setEditValue={setEditValue}
                      handleEditChat={handleEditChat}
                      handleSaveEdit={(chatId) => chatRenameMutation({ chatId, name: editValue })}
                      setActiveChatId={(chatId) => {
                        setIsOpen(false);
                        setActiveChatId(chatId);
                      }}
                      handleCancelEdit={handleCancelEdit}
                      handleDeleteChat={(chatId) => chatDeleteMutation(chatId)}
                    />
                  ))}
                </div>
              )
          )}
          {Object.keys(groupedHistory).length === 0 && (
            <div className="px-3 pt-3 text-center text-xs text-muted-foreground">
              {searchValue ? t('table:aiChat.noFoundHistory') : t('table:aiChat.noHistory')}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ChatHistoryItem = ({
  chat,
  editValue,
  editingChatId,
  setEditValue,
  handleEditChat,
  handleSaveEdit,
  setActiveChatId,
  handleCancelEdit,
  handleDeleteChat,
}: {
  chat: IChatHistoryItem;
  editValue: string;
  editingChatId: string | null;
  setEditValue: (value: string) => void;
  handleEditChat: (chat: IChatHistoryItem) => void;
  handleSaveEdit: (chatId: string) => void;
  setActiveChatId: (id: string) => void;
  handleCancelEdit: () => void;
  handleDeleteChat: (chatId: string) => void;
}) => {
  return (
    <div
      key={chat.id}
      className="group mx-0.5 flex size-full h-8 cursor-pointer items-center justify-between px-2"
      onClick={() => editingChatId !== chat.id && setActiveChatId(chat.id)}
    >
      {editingChatId === chat.id ? (
        <div className="flex w-full items-center gap-2">
          <Input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit(chat.id);
              if (e.key === 'Escape') handleCancelEdit();
            }}
            className="h-7 flex-1 rounded border px-2 py-1 text-sm"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-4"
            onClick={(e) => {
              e.stopPropagation();
              handleSaveEdit(chat.id);
            }}
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6  "
            onClick={(e) => {
              e.stopPropagation();
              handleCancelEdit();
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <p className="line-clamp-1  flex-1 text-[13px]">{chat.name}</p>
          <div className="hidden items-center gap-1 group-hover:flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 "
              onClick={(e) => {
                e.stopPropagation();
                handleEditChat(chat);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 "
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteChat(chat.id);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
