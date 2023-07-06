import * as React from 'react';
import type { SVGProps } from 'react';
const Siren = (props: SVGProps<SVGSVGElement>) => (
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
      d="M7 12a5 5 0 1 1 10 0v6H7v-6ZM5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2H5v-2ZM21 12h1M18.5 4.5 18 5M2 12h1M12 2v1M4.929 4.929l.707.707M12 12v6"
    />
  </svg>
);
export default Siren;
