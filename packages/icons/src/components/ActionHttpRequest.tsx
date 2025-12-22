import * as React from 'react';
import type { SVGProps } from 'react';

interface ActionHttpRequestProps extends SVGProps<SVGSVGElement> {
  withBackground?: boolean;
}

const ActionHttpRequest = ({ withBackground = true, ...props }: ActionHttpRequestProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    {withBackground && <rect width={24} height={24} fill="#EF4444" fillOpacity="0.1" />}
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4ZM6.0835 13C6.42715 15.0482 7.80802 16.7444 9.66797 17.5298C8.87723 16.1452 8.38972 14.6008 8.24561 13H6.0835ZM15.7544 13C15.6103 14.6009 15.1224 16.1452 14.3315 17.5298C16.1917 16.7445 17.5728 15.0483 17.9165 13H15.7544ZM10.2554 13C10.4326 14.612 11.035 16.1477 12 17.4492C12.965 16.1477 13.5674 14.612 13.7446 13H10.2554ZM9.66797 6.46973C7.80793 7.25503 6.42716 8.95175 6.0835 11H8.24561C8.38973 9.39901 8.8771 7.8544 9.66797 6.46973ZM12 6.55029C11.0349 7.8519 10.4326 9.38789 10.2554 11H13.7446C13.5674 9.38789 12.9651 7.8519 12 6.55029ZM14.3315 6.46973C15.1225 7.85445 15.6103 9.39893 15.7544 11H17.9165C17.5728 8.9516 16.1918 7.25496 14.3315 6.46973Z"
      fill="#EF4444"
    />
  </svg>
);
export default ActionHttpRequest;
