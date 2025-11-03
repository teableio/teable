import * as React from 'react';
import type { SVGProps } from 'react';
const FileAudio = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="72"
    height="72"
    viewBox="0 0 72 72"
    fill="none"
    {...props}
  >
    <g clipPath="url(#clip0_260_33132)">
      <circle cx="36" cy="36" r="36" fill="#EC4899" />
      <rect x="33.5" y="18" width="5" height="36" rx="2.5" fill="white" />
      <rect x="43.5" y="24" width="5" height="24" rx="2.5" fill="#FBCFE8" />
      <rect x="24" y="29" width="5" height="14" rx="2.5" fill="#FBCFE8" />
      <rect x="53.5" y="30" width="5" height="12" rx="2.5" fill="#F9A8D4" />
      <rect x="14" y="26" width="5" height="20" rx="2.5" fill="#F9A8D4" />
    </g>
    <defs>
      <clipPath id="clip0_260_33132">
        <rect width="72" height="72" fill="white" />
      </clipPath>
    </defs>
  </svg>
);
export default FileAudio;
