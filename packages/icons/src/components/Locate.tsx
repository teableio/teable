import * as React from 'react';
import type { SVGProps } from 'react';
const Locate = (props: SVGProps<SVGSVGElement>) => (
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
      d="M2 12h3M19 12h3M12 2v3M12 19v3M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
    />
  </svg>
);
export default Locate;
