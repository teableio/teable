import { Buffer } from 'buffer';
import jschardet from 'jschardet';

export const transformTextFile2UTF8 = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const arrayBuffer = event?.target?.result;

      if (!arrayBuffer) {
        resolve(file);
      }

      const uint8Array = new Uint8Array(arrayBuffer as ArrayBuffer);

      let text;
      try {
        const result = jschardet.detect(Buffer.from(uint8Array));
        if (!result.encoding) {
          resolve(file);
        }
        const decoder = new TextDecoder(result.encoding, { fatal: true });
        text = decoder.decode(uint8Array);
      } catch (e) {
        resolve(file);
      }

      const encoder = new TextEncoder();
      const utf8Array = encoder.encode(text);

      const utf8Blob = new Blob([utf8Array], { type: file.type });

      const utf8File = new File([utf8Blob], file.name, { type: file.type });

      resolve(utf8File);
    };

    reader.onerror = (error) => {
      reject(error);
    };

    if (file.type.includes('text')) {
      reader.readAsArrayBuffer(file);
    } else {
      resolve(file);
    }
  });
};
