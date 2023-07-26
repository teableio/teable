import type {
  AttachmentField,
  DateField,
  MultipleSelectField,
  Record,
  LinkField,
  SingleSelectField,
} from '@teable-group/sdk';

export interface IWrapperEditorProps {
  field: SingleSelectField | MultipleSelectField | AttachmentField | DateField | LinkField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}
