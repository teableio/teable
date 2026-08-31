import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Every owner of the top-banner stack. Registration overwrites by id and
 * unregistration deletes by id, so two owners sharing one would evict each other.
 */
export enum TopBannerId {
  LicenseExpiry = 'license-expiry',
  Announcement = 'announcement',
  /** Claims no slot; exists so the preview cannot unregister the real banner. */
  AnnouncementPreview = 'announcement-preview',
}

interface ITopBannerEntry {
  id: TopBannerId;
  height: number;
  /** Higher wins the upper slot. */
  priority: number;
}

interface ITopBannerState {
  entries: ITopBannerEntry[];
  register: (entry: ITopBannerEntry) => void;
  unregister: (id: TopBannerId) => void;
}

const sortEntries = (entries: ITopBannerEntry[]) =>
  [...entries].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

const useTopBannerStore = create<ITopBannerState>((set) => ({
  entries: [],
  register: (entry) =>
    set(({ entries }) => ({
      entries: sortEntries([...entries.filter((item) => item.id !== entry.id), entry]),
    })),
  unregister: (id) => set(({ entries }) => ({ entries: entries.filter((e) => e.id !== id) })),
}));

/**
 * Shared stack for the fixed banners above the app shell. Several can be on
 * screen at once, so the total height driving `--teable-top-banner-height` is
 * owned here; each caller gets back the offset it should render at.
 */
export const useTopBannerSlot = ({
  id,
  height,
  priority = 0,
  visible,
}: {
  id: TopBannerId;
  height: number;
  priority?: number;
  visible: boolean;
}) => {
  const entries = useTopBannerStore((state) => state.entries);
  const register = useTopBannerStore((state) => state.register);
  const unregister = useTopBannerStore((state) => state.unregister);

  useEffect(() => {
    if (!visible) {
      unregister(id);
      return;
    }
    register({ id, height, priority });
    return () => unregister(id);
  }, [id, height, priority, visible, register, unregister]);

  const totalHeight = entries.reduce((sum, entry) => sum + entry.height, 0);

  useEffect(() => {
    if (!totalHeight) {
      document.documentElement.style.removeProperty('--teable-top-banner-height');
      delete document.body.dataset.teableTopBanner;
      return;
    }
    document.documentElement.style.setProperty('--teable-top-banner-height', `${totalHeight}px`);
    document.body.dataset.teableTopBanner = 'visible';
  }, [totalHeight]);

  useEffect(() => {
    return () => {
      if (!useTopBannerStore.getState().entries.length) {
        document.documentElement.style.removeProperty('--teable-top-banner-height');
        delete document.body.dataset.teableTopBanner;
      }
    };
  }, []);

  const index = entries.findIndex((entry) => entry.id === id);
  const offset =
    index < 0 ? 0 : entries.slice(0, index).reduce((sum, entry) => sum + entry.height, 0);

  return { offset };
};
