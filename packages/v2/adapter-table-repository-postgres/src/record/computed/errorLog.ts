export const toErrorLogFields = (
  error: unknown
): { error: string; errorName?: string; errorStack?: string } => {
  if (error instanceof Error) {
    return {
      error: error.message || error.name,
      ...(error.name ? { errorName: error.name } : {}),
      ...(error.stack ? { errorStack: error.stack } : {}),
    };
  }

  if (typeof error === 'string') {
    return { error };
  }

  try {
    const serialized = JSON.stringify(error);
    return { error: serialized ?? String(error) };
  } catch {
    return { error: String(error) };
  }
};
