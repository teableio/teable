/* eslint-disable @next/next/no-before-interactive-script-outside-document */
import Script from 'next/script';

export const SideBarScript = () => {
  return (
    <Script id="init-sidebar-width" strategy="beforeInteractive">
      {`
         let sidebarWidth = 288;
          try {
            sidebarWidth = JSON.parse(localStorage.getItem('ls_sidebar') || '{}')?.state?.width || 288;
          } catch (error) {
            console.error('Error parsing sidebar width', error);
          }
          document.documentElement.style.setProperty('--sidebar-width', sidebarWidth.toString() + 'px');
      `}
    </Script>
  );
};
