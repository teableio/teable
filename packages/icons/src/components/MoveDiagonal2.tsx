import * as React from 'react';
import type { SVGProps } from 'react';
const MoveDiagonal2 = (props: SVGProps<SVGSVGElement>) => (
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
      d="M5 11V5h6M19 13v6h-6M5 5l14 14"
    />
  </svg>
);
export default MoveDiagonal2;
