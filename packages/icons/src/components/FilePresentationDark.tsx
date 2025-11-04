import * as React from 'react';
import type { SVGProps } from 'react';
const FilePresentationDark = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="120"
    height="120"
    fill="none"
    viewBox="0 0 120 120"
    {...props}
  >
    <path fill="#FFAF78" fillOpacity=".16" d="M0 0h120v120H0z" />
    <g clipPath="url(#a)">
      <path
        fill="#FF8C3D"
        d="M32 30a6 6 0 0 1 6-6h34l16 16v50a6 6 0 0 1-6 6H38a6 6 0 0 1-6-6V30Z"
      />
      <path fill="#FFBA8B" d="m72 24 16 16H75a3 3 0 0 1-3-3V24Z" />
      <path
        fill="#FFF4ED"
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
export default FilePresentationDark;
