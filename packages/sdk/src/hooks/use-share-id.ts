import { useContext } from 'react';
import { AppContext } from '../context';

export const useShareId = () => {
  const { shareId } = useContext(AppContext) || {};
  return !!shareId;
};
