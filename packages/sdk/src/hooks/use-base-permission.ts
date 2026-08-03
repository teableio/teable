import { useContext } from 'react';
import { BaseContext } from '../context';

export const useBasePermission = () => {
  const { permission } = useContext(BaseContext);

  return permission;
};
