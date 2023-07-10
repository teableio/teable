import * as React from 'react';
import type { SVGProps } from 'react';
const FileVolume = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v3"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M14 2v6h6M7 10l-3 2H2v4h2l3 2v-8ZM11 11c.64.8 1 1.87 1 3s-.36 2.2-1 3"
    />
  </svg>
);
export default FileVolume;
