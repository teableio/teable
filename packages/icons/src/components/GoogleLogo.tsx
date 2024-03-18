import * as React from 'react';
import type { SVGProps } from 'react';
const GoogleLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__a)">
      <path
        fill="#4285F4"
        d="M24 12.276c0-.816-.068-1.636-.212-2.439H12.24v4.621h6.613a5.55 5.55 0 0 1-2.447 3.647v2.998h3.945C22.668 19.013 24 15.927 24 12.276"
      />
      <path
        fill="#34A853"
        d="M12.24 24c3.302 0 6.087-1.062 8.116-2.897l-3.946-2.998c-1.097.732-2.514 1.146-4.165 1.146-3.194 0-5.902-2.112-6.874-4.951H1.3v3.09C3.378 21.444 7.61 24 12.24 24"
      />
      <path
        fill="#FBBC04"
        d="M5.367 14.3a7.05 7.05 0 0 1 0-4.595v-3.09H1.3a11.8 11.8 0 0 0 0 10.776z"
      />
      <path
        fill="#EA4335"
        d="M12.24 4.75a6.73 6.73 0 0 1 4.697 1.798l3.495-3.426A11.9 11.9 0 0 0 12.24 0C7.611 0 3.378 2.558 1.3 6.614l4.066 3.091c.968-2.844 3.68-4.956 6.874-4.956"
      />
    </g>
    <defs>
      <clipPath id="prefix__a">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default GoogleLogo;
