import { useContext } from 'react';
import { AppContext } from '../context';

export const useIsReadOnlyPreview = () => {
  const { template, shareId } = useContext(AppContext) || {};
  // Return true for template or share mode (both are read-only previews)
  return !!template || !!shareId;
};
