/** Domain code survives both HTTP and ShareDB adapters; HTTP status alone is insufficient. */
export const isTableProvisionPending = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === 'table.provision_pending') return true;
  if (!('data' in error) || !error.data || typeof error.data !== 'object') return false;
  return 'domainCode' in error.data && error.data.domainCode === 'table.provision_pending';
};
