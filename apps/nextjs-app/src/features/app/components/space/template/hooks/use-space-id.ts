import { useContext } from 'react';
import { TemplateContext } from '../context';

export const useSpaceId = () => {
  const { spaceId } = useContext(TemplateContext);
  return spaceId;
};
