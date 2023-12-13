import * as React from 'react';
import type { SVGProps } from 'react';
const Network = (props: SVGProps<SVGSVGElement>) => (
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
      d="M15 2H9v6h6zM22 16h-6v6h6zM8 16H2v6h6zM5 16v-4h14v4M12 12V8"
    />
  </svg>
);
export default Network;
