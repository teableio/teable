import { useContext } from 'react';
import { ActionTriggerContext } from '../context/action-trigger';

export const useActionTrigger = () => {
  return useContext(ActionTriggerContext);
};
