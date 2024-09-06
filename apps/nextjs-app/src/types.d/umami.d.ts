declare interface Window {
  umami?: {
    identify: (props: { email?: string; id?: string; name?: string }) => void;
  };
}
