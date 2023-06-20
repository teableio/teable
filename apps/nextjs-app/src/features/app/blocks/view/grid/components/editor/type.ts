import type {
  AttachmentField,
  DateField,
  MultipleSelectField,
  Record,
  SingleSelectField,
} from '@teable-group/sdk';

export interface IEditorProps {
  field: SingleSelectField | MultipleSelectField | AttachmentField | DateField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}
