import type { McpToolInvocationName } from '@teable/openapi';
import { create } from 'zustand';

interface IChatControlState {
  toolCallInfo: {
    tableId: string | null;
    toolName: McpToolInvocationName | null;
  };
  setToolCallInfo: (tableId: string | null, toolName: McpToolInvocationName | null) => void;
}

export const useChatControlStore = create<IChatControlState>()((set) => ({
  toolCallInfo: {
    tableId: null,
    toolName: null,
  },
  setToolCallInfo: (tableId: string | null, toolName: McpToolInvocationName | null) =>
    set({ toolCallInfo: { tableId, toolName } }),
}));
