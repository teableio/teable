import * as React from 'react';
import type { SVGProps } from 'react';
const FilePresentation = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="120"
    height="120"
    fill="none"
    viewBox="0 0 120 120"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path fill="#FFEDD5" d="M0 0h120v120H0z" />
    <g clipPath="url(#a)">
      <path
        fill="#F97316"
        d="M32 30a6 6 0 0 1 6-6h34l16 16v50a6 6 0 0 1-6 6H38a6 6 0 0 1-6-6V30Z"
      />
      <path fill="#FDBA74" d="m72 24 16 16H75a3 3 0 0 1-3-3V24Z" />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M62 49.5a9.5 9.5 0 0 1 0 19h-8.5V80a2.5 2.5 0 0 1-5 0V52.107a2.607 2.607 0 0 1 2.607-2.607H62Zm-8.5 14H62a4.5 4.5 0 1 0 0-9h-8.5v9Z"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="a">
        <path fill="#fff" d="M32 24h56v72H32z" />
      </clipPath>
    </defs>
  </svg>
);
export default FilePresentation;
