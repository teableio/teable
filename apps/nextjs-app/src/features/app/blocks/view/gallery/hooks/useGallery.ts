import { useContext } from 'react';
import { GalleryContext } from '../context';

export const useGallery = () => {
  return useContext(GalleryContext);
};
