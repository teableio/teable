import { useContext } from 'react';
import { ModalContext } from './ModalContext';

export const useModalRefElement = () => {
  const { ref } = useContext(ModalContext);
  return ref;
};
