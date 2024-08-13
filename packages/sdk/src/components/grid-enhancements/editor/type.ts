import type {
  AttachmentField,
  DateField,
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
    | UserField
    | CreatedByField
    | LastModifiedByField
    | NumberField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}
