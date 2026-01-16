import * as React from 'react';
import type { SVGProps } from 'react';
const Perplexity = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      fill="#20808D"
      d="M12 2 4 7v10l8 5 8-5V7zm0 2.5L17.5 8 12 11.5 6.5 8zM6 9.5l5 3v6l-5-3zm7 9v-6l5-3v6z"
    />
  </svg>
);
export default Perplexity;
