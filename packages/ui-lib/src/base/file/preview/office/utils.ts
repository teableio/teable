export const getBlobFromUrl = async (url: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.blob();
  } catch (error) {
    console.error('Error fetching file', error);
    throw error;
  }
};

export const numberCoordinate2Letter = (n: number) => {
  let result = '';
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode((n % 26) + 'A'.charCodeAt(0)) + result;
    n = Math.floor(n / 26);
  }
  return result;
};
