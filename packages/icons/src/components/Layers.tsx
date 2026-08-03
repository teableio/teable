import * as React from 'react';
import type { SVGProps } from 'react';
const Layers = (props: SVGProps<SVGSVGElement>) => (
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
      d="m2 17 10 5 10-5M2 12l10 5 10-5M12 2 2 7l10 5 10-5z"
    />
  </svg>
);
export default Layers;
