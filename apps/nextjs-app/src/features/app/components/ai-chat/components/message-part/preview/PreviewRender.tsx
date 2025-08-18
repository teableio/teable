import { McpToolInvocationName } from '@teable/openapi';
import {
  AnchorContext,
  FieldProvider,
  RowCountProvider,
  TablePermissionProvider,
} from '@teable/sdk/context';
import { useBaseId } from '@teable/sdk/hooks/use-base-id';
import { ErrorBoundary } from 'react-error-boundary';
import type { IToolMessagePart } from '../ToolMessagePart';
import { DefaultRender } from './DefaultRender';
import { ErrorFallback } from './ErrorFallback';
import { GridPreView } from './GridPreview';
import { TableListDiffPreview } from './TableListDiffPreview';
import { ViewListDiffPreview } from './ViewListDiffPreview';

interface IAIChangePreviewProps {
  id: string;
  toolInvocation: IToolMessagePart['part']['toolInvocation'];
}

export const PreviewRender = (props: IAIChangePreviewProps) => {
  const { toolInvocation, id } = props;
  const baseId = useBaseId()!;
  const tableId = toolInvocation.args?.['tableId'];
  const toolName = toolInvocation.toolName;

  const previewRender = () => {
    switch (toolName) {
      case McpToolInvocationName.CreateTable:
      case McpToolInvocationName.DeleteTable:
      case McpToolInvocationName.UpdateTableName: {
        return <TableListDiffPreview toolInvocation={toolInvocation} />;
      }
      case McpToolInvocationName.CreateView:
      case McpToolInvocationName.DeleteView:
      case McpToolInvocationName.UpdateViewName: {
        return <ViewListDiffPreview toolInvocation={toolInvocation} />;
      }
      case McpToolInvocationName.CreateFields:
      case McpToolInvocationName.CreateRecords:
      case McpToolInvocationName.DeleteFields:
      case McpToolInvocationName.DeleteRecords:
      case McpToolInvocationName.UpdateField:
      case McpToolInvocationName.UpdateRecords: {
        return (
          <div className="relative h-48">
            <RowCountProvider>
              <GridPreView toolInvocation={toolInvocation} />
            </RowCountProvider>
          </div>
        );
      }
      case McpToolInvocationName.GetTableFields:
      default: {
        return (
          <DefaultRender
            id={id}
            toolInvocation={
              toolInvocation as IToolMessagePart['part']['toolInvocation'] & { state: 'result' }
            }
          />
        );
      }
    }
  };
  return (
    <>
      <AnchorContext.Provider key={tableId} value={{ baseId, tableId }}>
        <TablePermissionProvider baseId={baseId}>
          <FieldProvider>
            <ErrorBoundary FallbackComponent={ErrorFallback}>{previewRender()}</ErrorBoundary>
          </FieldProvider>
        </TablePermissionProvider>
      </AnchorContext.Provider>
    </>
  );
};
