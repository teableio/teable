import type {
  AttachmentField,
  DateField,
  LongTextField,
  MultipleSelectField,
  Record,
  LinkField,
  SingleSelectField,
  UserField,
  NumberField,
  CreatedByField,
  LastModifiedByField,
} from '../../../model';

export interface IWrapperEditorProps {
  field:
    | SingleSelectField
    | MultipleSelectField
    | AttachmentField
    | DateField
    | LinkField
    | LongTextField
    | UserField
    | CreatedByField
    | LastModifiedByField
    | NumberField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}
