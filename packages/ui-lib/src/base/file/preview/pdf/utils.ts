export const urlToBase64 = async (
  url: string
): Promise<{ base64: string; base64WithPrefix: string }> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = String(reader.result);
        base64String &&
          resolve({
            base64: base64String.split(',')[1],
            base64WithPrefix: base64String,
          });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    throw new Error(`Failed to convert URL to base64: ${(error as Error)?.message}`);
  }
};
