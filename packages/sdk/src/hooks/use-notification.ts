import { useContext } from 'react';
import { NotificationContext } from '../context';

export const useNotification = () => {
  return useContext(NotificationContext);
};
