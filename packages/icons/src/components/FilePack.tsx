import * as React from 'react';
import type { SVGProps } from 'react';
const FilePack = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="120"
    height="120"
    fill="none"
    viewBox="0 0 120 120"
    {...props}
  >
    <path fill="#FEF3C7" d="M0 0h120v120H0z" />
    <rect width="64" height="64" x="28" y="28" fill="#FBBF24" rx="6" />
    <path fill="#F59E0B" d="M67 28h14v30a7 7 0 1 1-14 0z" />
    <path
      fill="#fff"
      d="M74 28a1 1 0 0 1 1 1v1h2a1 1 0 1 1 0 2h-2v2h2a1 1 0 1 1 0 2h-2v2h2a1 1 0 1 1 0 2h-2v2h2a1 1 0 1 1 0 2h-2v2h2a1 1 0 1 1 0 2h-2v2h2a1 1 0 1 1 0 2h-2v2q0 .063-.009.124A4.001 4.001 0 0 1 74 62a4 4 0 0 1-.992-7.876l-.003-.022L73 54h-2a1 1 0 1 1 0-2h2v-2h-2a1 1 0 1 1 0-2h2v-2h-2a1 1 0 1 1 0-2h2v-2h-2a1 1 0 1 1 0-2h2v-2h-2a1 1 0 1 1 0-2h2v-2h-2a1 1 0 1 1 0-2h2v-3a1 1 0 0 1 1-1m0 28a2 2 0 1 0 0 4 2 2 0 0 0 0-4"
    />
  </svg>
);
export default FilePack;
