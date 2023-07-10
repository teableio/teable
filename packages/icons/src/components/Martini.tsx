import * as React from 'react';
import type { SVGProps } from 'react';
const Martini = (props: SVGProps<SVGSVGElement>) => (
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
      d="M8 22h8M12 11v11M19 3l-7 8-7-8h14Z"
    />
  </svg>
);
export default Martini;
