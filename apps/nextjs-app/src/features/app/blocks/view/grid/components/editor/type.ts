import type {
  AttachmentField,
  MultipleSelectField,
  Record,
  SingleSelectField,
} from '@teable-group/sdk';

export interface IEditorProps {
  field: SingleSelectField | MultipleSelectField | AttachmentField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}
