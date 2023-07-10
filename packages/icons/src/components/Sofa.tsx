import * as React from 'react';
import type { SVGProps } from 'react';
const Sofa = (props: SVGProps<SVGSVGElement>) => (
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
      d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 1 0-4 0v2H6v-2a2 2 0 0 0-4 0ZM4 18v2M20 18v2M12 4v9"
    />
  </svg>
);
export default Sofa;
