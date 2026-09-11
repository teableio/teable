import * as React from 'react';
import type { SVGProps } from 'react';
const Facebook = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    {...props}
  >
    <rect width={24} height={24} fill="white" fillOpacity={0.01} />
    <g clipPath="url(#facebook_clip0_1729_3275)">
      <mask
        id="facebook_mask0_1729_3275"
        style={{
          maskType: 'luminance',
        }}
        maskUnits="userSpaceOnUse"
        x={-4}
        y={-4}
        width={32}
        height={32}
      >
        <path d="M-3.17221 -3.22499H27.2778V27.225H-3.17221V-3.22499Z" fill="white" />
      </mask>
      <g mask="url(#facebook_mask0_1729_3275)">
        <path
          d="M22.9275 12.0001C22.9275 5.994 18.0586 1.12509 12.0525 1.12509C6.0464 1.12509 1.17749 5.994 1.17749 12.0001C1.17749 17.1002 4.68859 21.3796 9.42535 22.5548V15.3233H7.18284V12.0001H9.42535V10.5681C9.42535 6.86661 11.1004 5.15097 14.7344 5.15097C15.4234 5.15097 16.6122 5.28604 17.0985 5.42115V8.4337C16.8418 8.40669 16.3961 8.39316 15.8422 8.39316C14.059 8.39316 13.37 9.06862 13.37 10.8248V12.0001H16.9221L16.3119 15.3233H13.37V22.7954C18.7547 22.1451 22.9275 17.5602 22.9275 12.0001Z"
          fill="#0866FF"
        />
        <path
          d="M16.3123 15.3234L16.9225 12.0002H13.3704V10.8248C13.3704 9.06865 14.0593 8.39322 15.8425 8.39322C16.3964 8.39322 16.8422 8.40671 17.0989 8.43372V5.42122C16.6126 5.2861 15.4237 5.15099 14.7348 5.15099C11.1009 5.15099 9.42571 6.86668 9.42571 10.5682V12.0002H7.1832V15.3234H9.42571V22.5549C10.2671 22.7636 11.1469 22.8752 12.0528 22.8752C12.4989 22.8752 12.9384 22.8477 13.3704 22.7955V15.3234H16.3123Z"
          fill="white"
        />
      </g>
    </g>
    <defs>
      <clipPath id="facebook_clip0_1729_3275">
        <rect width={21.75} height={21.75} fill="white" transform="translate(1.1778 1.125)" />
      </clipPath>
    </defs>
  </svg>
);
export default Facebook;
