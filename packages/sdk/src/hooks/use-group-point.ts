import { useContext } from 'react';
import { GroupPointContext } from '../context';

export const useGroupPoint = () => {
  return useContext(GroupPointContext);
};
