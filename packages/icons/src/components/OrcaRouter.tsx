import * as React from 'react';
import type { SVGProps } from 'react';
const OrcaRouter = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="#94A3B8"
      strokeWidth={1.5}
      strokeLinecap="round"
      d="M7 11.2 16.4 5.6M7.4 12H16.6M7 12.8 16.4 18.4"
    />
    <circle cx="5" cy="12" r="2.6" fill="#94A3B8" />
    <circle cx="18.8" cy="5" r="2.6" fill="#94A3B8" />
    <circle cx="18.8" cy="12" r="2.6" fill="#94A3B8" />
    <circle cx="18.8" cy="19" r="2.6" fill="#94A3B8" />
  </svg>
);
export default OrcaRouter;
