import * as React from 'react';
import type { SVGProps } from 'react';
const SwitchCamera = (props: SVGProps<SVGSVGElement>) => (
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
      d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 22l-3-3 3-3M6 2l3 3-3 3"
    />
  </svg>
);
export default SwitchCamera;
