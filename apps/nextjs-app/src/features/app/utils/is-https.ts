export function isHTTPS() {
  const protocol = window.location.protocol;

  return protocol === 'https:';
}
