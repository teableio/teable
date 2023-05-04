import { useContext } from 'react';
import { FieldContext } from '../context';

export function useField(fieldId?: string) {
  const { fields } = useContext(FieldContext);
  return fields.find((field) => field.id === fieldId);
}
