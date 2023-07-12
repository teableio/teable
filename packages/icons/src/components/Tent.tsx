import * as React from 'react';
import type { SVGProps } from 'react';
const Tent = (props: SVGProps<SVGSVGElement>) => (
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
      d="M19 20 10 4M5 20l9-16M3 20h18M12 15l-3 5M12 15l3 5"
    />
  </svg>
);
export default Tent;
