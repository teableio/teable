import { useContext } from 'react';
import { BaseFilterContext } from '../context';

export const useCrud = () => {
  const { createCondition, onDelete, onChange, getValue } = useContext(BaseFilterContext);
  return { createCondition, onDelete, onChange, getValue };
};
