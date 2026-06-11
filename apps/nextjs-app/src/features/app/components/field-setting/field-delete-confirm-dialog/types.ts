export interface FieldDeleteConfirmDialogProps {
  open: boolean;
  tableId: string;
  fieldIds: string[];
  onClose?: () => void;
}

export type AffectedItemType = 'field' | 'workflow' | 'authorityMatrix' | 'view';

export interface AffectedBaseSource {
  id: string;
  name: string;
  icon?: string | null;
}

export interface AffectedTableSource {
  id: string;
  name: string;
  icon?: string | null;
  base: AffectedBaseSource;
}

export interface AffectedWorkflowSource {
  id: string;
  name: string;
  base: AffectedBaseSource;
}

export type AffectedItemSource = AffectedTableSource | AffectedWorkflowSource;

export interface AffectedItem {
  id: string;
  name: string;
  itemType: AffectedItemType;
  type?: string;
  source?: AffectedItemSource;
}
