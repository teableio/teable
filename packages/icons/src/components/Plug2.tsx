import * as React from 'react';
import type { SVGProps } from 'react';
const Plug2 = (props: SVGProps<SVGSVGElement>) => (
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
      d="M9 2v6M15 2v6M12 17v5M5 8h14M6 11V8h12v3a6 6 0 1 1-12 0Z"
    />
  </svg>
);
export default Plug2;
