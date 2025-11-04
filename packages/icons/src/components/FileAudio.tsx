import * as React from 'react';
import type { SVGProps } from 'react';
const FileAudio = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="120"
    height="120"
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect width="120" height="120" fill="#FCE7F3" />
    <g clipPath="url(#clip0_221_32614)">
      <circle cx="60" cy="60" r="36" fill="#EC4899" />
      <rect x="57.5" y="42" width="5" height="36" rx="2.5" fill="white" />
      <rect x="67.5" y="48" width="5" height="24" rx="2.5" fill="#FBCFE8" />
      <rect x="48" y="53" width="5" height="14" rx="2.5" fill="#FBCFE8" />
      <rect x="77.5" y="54" width="5" height="12" rx="2.5" fill="#F9A8D4" />
      <rect x="38" y="50" width="5" height="20" rx="2.5" fill="#F9A8D4" />
    </g>
    <defs>
      <clipPath id="clip0_221_32614">
        <rect width="72" height="72" fill="white" transform="translate(24 24)" />
      </clipPath>
    </defs>
  </svg>
);
export default FileAudio;
