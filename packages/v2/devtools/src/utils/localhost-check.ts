/**
 * Check if connection string is localhost only.
 * This is a security measure to prevent mock data generation on remote databases.
 */
export const isLocalhostConnection = (connStr: string): boolean => {
  try {
    const url = new URL(connStr);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('127.')
    );
  } catch {
    // If URL parsing fails, try regex match
    return /(@localhost|@127\.0\.0\.1|@::1|@127\.)/.test(connStr);
  }
};
