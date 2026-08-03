import * as React from 'react';
import type { SVGProps } from 'react';
const Hash = (props: SVGProps<SVGSVGElement>) => (
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
      d="M4 9h16M4 15h16M10 3 8 21m8-18-2 18"
    />
  </svg>
);
export default Hash;
