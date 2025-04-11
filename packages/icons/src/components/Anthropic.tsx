import * as React from 'react';
import type { SVGProps } from 'react';
const Anthropic = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__anthropic)">
      <path fill="#CA9F7B" d="M6 0h12q6 0 6 6v12q0 6-6 6H6q-6 0-6-6V6q0-6 6-6" />
      <path
        fill="#191918"
        d="M15.384 6.435H12.97l4.405 11.13h2.416zm-6.979 0L4 17.565h2.463l.901-2.337h4.609l.9 2.337h2.464l-4.405-11.13zm-.244 6.726 1.508-3.912 1.507 3.912z"
      />
    </g>
    <defs>
      <clipPath id="prefix__anthropic">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default Anthropic;
