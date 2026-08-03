import { useContext } from 'react';
import { BaseNodeContext } from '../BaseNodeContext';

export const useBaseNodeContext = () => {
  return useContext(BaseNodeContext);
};
