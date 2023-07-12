import * as React from 'react';
import type { SVGProps } from 'react';
const LampCeiling = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 2v5M6 7h12l4 9H2l4-9ZM9.17 16a3 3 0 1 0 5.66 0"
    />
  </svg>
);
export default LampCeiling;
