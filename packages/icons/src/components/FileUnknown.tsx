import * as React from 'react';
import type { SVGProps } from 'react';
const FileUnknown = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="120"
    height="120"
    fill="none"
    viewBox="0 0 120 120"
    {...props}
  >
    <path fill="#F4F4F5" d="M0 0h120v120H0z" />
    <g clipPath="url(#a)">
      <path
        fill="#A1A1AA"
        d="M32 30a6 6 0 0 1 6-6h34l16 16v50a6 6 0 0 1-6 6H38a6 6 0 0 1-6-6V30Z"
      />
      <path
        fill="#E4E4E7"
        d="m72 24 16 16H75a3 3 0 0 1-3-3V24Zm4.5 58a2.5 2.5 0 0 1 0 5h-33a2.5 2.5 0 0 1 0-5h33Zm-16-9a2.5 2.5 0 0 1 0 5h-17a2.5 2.5 0 0 1 0-5h17Z"
      />
    </g>
    <defs>
      <clipPath id="a">
        <path fill="#fff" d="M32 24h56v72H32z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileUnknown;
