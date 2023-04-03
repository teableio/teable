import { useContext } from 'react';
import { ToastContext } from '../context';

export function useToast() {
  const { open } = useContext(ToastContext);
  return { open };
}
