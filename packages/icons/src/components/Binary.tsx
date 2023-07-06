import * as React from 'react';
import type { SVGProps } from 'react';
const Binary = (props: SVGProps<SVGSVGElement>) => (
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
      d="M6 20h4M14 10h4M6 14h2v6M14 4h2v6M10 4H6v6h4V4ZM18 14h-4v6h4v-6Z"
    />
  </svg>
);
export default Binary;
