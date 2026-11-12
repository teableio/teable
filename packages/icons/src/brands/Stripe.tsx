import * as React from 'react';
import type { SVGProps } from 'react';
const Stripe = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 512 512"
    {...props}
  >
    <rect width="512" height="512" fill="#533AFD" rx="64" />
    <path
      fill="#fff"
      fillRule="evenodd"
      d="M120 392 392 334.317V120L120 178.357z"
      clipRule="evenodd"
    />
  </svg>
);
export default Stripe;
