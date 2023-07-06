import * as React from 'react';
import type { SVGProps } from 'react';
const SunDim = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 4h.01M20 12h.01M12 20h.01M4 12h.01M17.657 6.343h.01M17.657 17.657h.01M6.343 17.657h.01M6.343 6.343h.01"
    />
  </svg>
);
export default SunDim;
