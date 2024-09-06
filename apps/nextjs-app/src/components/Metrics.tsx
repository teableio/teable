import Script from 'next/script';

export const MicrosoftClarity = ({
  clarityId,
  user,
}: {
  clarityId?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
}) => {
  if (!clarityId) {
    return null;
  }

  return (
    <>
      <Script
        id="microsoft-clarity-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
        (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${clarityId}");
        `,
        }}
      />
      <Script
        id="microsoft-clarity-identify"
        dangerouslySetInnerHTML={{
          __html: `window.clarity && window.clarity("identify", "${user?.email || user?.id}");`,
        }}
      />
    </>
  );
};

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
  if (!umamiWebSiteId || !umamiUrl) {
    return null;
  }

  return (
    <>
      <Script
        id="umami-init"
        defer
        src={umamiUrl}
        data-website-id={umamiWebSiteId}
        onLoad={() => {
          if (user) {
            window.umami &&
              window.umami.identify({ email: user.email, id: user.id, name: user.name });
          }
        }}
      />
    </>
  );
};
