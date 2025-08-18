import { McpToolInvocationName } from '@teable/openapi';
import colors from 'tailwindcss/colors';

export const PreviewActionColorMap = {
  create: colors.green[400],
  delete: colors.red[400],
  update: colors.yellow[400],
  expired: colors.gray[400],
};

export const PreviewMcpToolInvocationNames = [
  McpToolInvocationName.CreateTable,
  McpToolInvocationName.CreateView,
  McpToolInvocationName.CreateFields,
  McpToolInvocationName.CreateRecords,
  McpToolInvocationName.UpdateTableName,
  McpToolInvocationName.UpdateViewName,
  McpToolInvocationName.UpdateRecords,
  McpToolInvocationName.UpdateField,
  McpToolInvocationName.DeleteTable,
  McpToolInvocationName.DeleteFields,
  McpToolInvocationName.DeleteRecords,
  McpToolInvocationName.DeleteView,
];
