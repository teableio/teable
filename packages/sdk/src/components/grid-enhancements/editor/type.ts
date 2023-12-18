import type {
  AttachmentField,
  DateField,
  MultipleSelectField,
  Record,
  LinkField,
  SingleSelectField,
  UserField,
} from '../../../model';

export interface IWrapperEditorProps {
  field:
    | SingleSelectField
    | MultipleSelectField
    | AttachmentField
    | DateField
    | LinkField
    | UserField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}
