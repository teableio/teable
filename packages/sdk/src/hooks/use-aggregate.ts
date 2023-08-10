import { useContext } from 'react';
import { AggregateContext } from '../context';

export const useAggregate = () => {
  return useContext(AggregateContext);
};
