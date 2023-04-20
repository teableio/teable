import { useContext } from 'react';
import { FieldContext } from '../context';

export function useFields() {
  const { fields } = useContext(FieldContext);
  return { fields };
}
