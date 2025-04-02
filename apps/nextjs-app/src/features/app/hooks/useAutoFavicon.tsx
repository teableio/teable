/**
 * IMPORTANT LEGAL NOTICE:
 *
 * This file is part of Teable, licensed under the GNU Affero General Public License (AGPL).
 *
 * While Teable is open source software, the brand assets (including but not limited to
 * the Teable name, logo, and brand identity) are protected intellectual property.
 * Modification, replacement, or removal of these brand assets is strictly prohibited
 * and constitutes a violation of our trademark rights and the terms of the AGPL license.
 *
 * Under Section 7(e) of AGPLv3, we explicitly reserve all rights to the
 * Teable brand assets. Any unauthorized modification, redistribution, or use
 * of these assets, including creating derivative works that remove or replace
 * the brand assets, may result in legal action.
 */

import { useEffect } from 'react';
import { useEnv } from './useEnv';

export const useAutoFavicon = () => {
  const env = useEnv();
  useEffect(() => {
    if (!env.brandLogo) {
      return;
    }

    const links = document.querySelectorAll("link[rel*='icon']");
    links.forEach((link) => link.remove());

    const newLink = document.createElement('link');
    newLink.type = 'image/x-icon';
    newLink.rel = 'shortcut icon';
    newLink.href = env.brandLogo;
    document.head.appendChild(newLink);
  }, [env.brandLogo]);
};
