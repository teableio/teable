import * as React from 'react';
import type { SVGProps } from 'react';
const Heading1 = (props: SVGProps<SVGSVGElement>) => (
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
      d="M4 12h8M4 18V6M12 18V6M17 12l3-2v8"
    />
  </svg>
);
export default Heading1;
