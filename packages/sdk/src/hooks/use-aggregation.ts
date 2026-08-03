import { useContext } from 'react';
import { AggregationContext } from '../context';

export const useAggregation = () => {
  return useContext(AggregationContext);
};
