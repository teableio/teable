import type {
  AttachmentField,
  DateField,
  MultipleSelectField,
  Record,
  LinkField,
  SingleSelectField,
  UserField,
  NumberField,
} from '../../../model';

export interface IWrapperEditorProps {
  field:
    | SingleSelectField
    | MultipleSelectField
    | AttachmentField
    | DateField
    | LinkField
    | UserField
    | NumberField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}
