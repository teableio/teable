import * as React from 'react';
import type { SVGProps } from 'react';
const Anchor = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 22V8M5 12H2a10 10 0 0 0 20 0h-3"
    />
  </svg>
);
export default Anchor;
