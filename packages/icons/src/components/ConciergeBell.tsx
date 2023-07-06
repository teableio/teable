import * as React from 'react';
import type { SVGProps } from 'react';
const ConciergeBell = (props: SVGProps<SVGSVGElement>) => (
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
      d="M2 18a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2H2v-2ZM20 16a8 8 0 0 0-16 0M12 4v4M10 4h4"
    />
  </svg>
);
export default ConciergeBell;
