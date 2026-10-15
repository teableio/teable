import { ANONYMOUS_USER_ID } from '@teable/core';
import Script from 'next/script';
import { useEffect, useState } from 'react';

// Real user ids are NOT required to carry the usr prefix (EE admin/API-created
// users can have custom ids) — only empty values and the reserved word
// 'anonymous' (case-insensitive) are excluded.
//
// Signed-out visitors on ensureLogin pages (/auth/login, /auth/signup via
// re-export, /invite, ...) get pageProps.user set to the backend's
// ANONYMOUS_USER, which carries a non-empty name ('Anonymous') and email
// ('anonymous@system.teable.ai') — so a truthy user or email is NOT proof of
// a signed-in account. Identity calls must pass this gate.
const isIdentifiableUserId = (userId?: string): userId is string =>
  !!userId && userId.trim().toLowerCase() !== ANONYMOUS_USER_ID;

export const Umami = ({
  umamiWebSiteId,
  umamiUrl,
  user,
}: {
  umamiWebSiteId?: string;
  umamiUrl?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
}) => {
  const userId = user?.id;
  const userEmail = user?.email;
  const userName = user?.name;
  const [isUmamiReady, setIsUmamiReady] = useState(false);

  // Identify from an effect, not the script's load callback alone: login goes
  // through a client-side router.push, which keeps this component mounted and
  // never re-fires onLoad — the session would stay unidentified until a full
  // page load. The effect re-runs whenever the user id changes (initial load,
  // login, account switch alike). Umami's script tracker has no reset API;
  // anonymous/invalid users skip identification and ride Umami's own visitor
  // id.
  useEffect(() => {
    if (!isUmamiReady || !isIdentifiableUserId(userId)) {
      return;
    }
    window.umami?.identify({ email: userEmail, id: userId, name: userName });
  }, [isUmamiReady, userId, userEmail, userName]);

  if (!umamiWebSiteId || !umamiUrl) {
    return null;
  }

  return (
    <Script
      id="umami-init"
      defer
      src={umamiUrl}
      data-website-id={umamiWebSiteId}
      onLoad={() => setIsUmamiReady(true)}
    />
  );
};
