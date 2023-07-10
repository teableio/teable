import * as React from 'react';
import type { SVGProps } from 'react';
const Voicemail = (props: SVGProps<SVGSVGElement>) => (
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
      d="M6 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM18 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM6 16h12"
    />
  </svg>
);
export default Voicemail;
