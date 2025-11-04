import * as React from 'react';
import type { SVGProps } from 'react';
const FileAudioDark = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="120"
    height="120"
    fill="none"
    viewBox="0 0 120 120"
    {...props}
  >
    <path fill="#FF95C9" fillOpacity=".16" d="M0 0h120v120H0z" />
    <g clipPath="url(#a)">
      <circle cx="60" cy="60" r="36" fill="#FF61AF" />
      <rect width="5" height="36" x="57.5" y="42" fill="#FFE5F2" rx="2.5" />
      <rect width="5" height="24" x="67.5" y="48" fill="#FFB8DB" rx="2.5" />
      <rect width="5" height="14" x="48" y="53" fill="#FFB8DB" rx="2.5" />
      <rect width="5" height="12" x="77.5" y="54" fill="#FFB1D8" rx="2.5" />
      <rect width="5" height="20" x="38" y="50" fill="#FFB1D8" rx="2.5" />
    </g>
    <defs>
      <clipPath id="a">
        <path fill="#fff" d="M24 24h72v72H24z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileAudioDark;
