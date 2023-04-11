import { useContext } from 'react';
import { FieldContext } from '../context';

export function useFields() {
  const { fields, setFields } = useContext(FieldContext);
  return { fields, setFields };
}
