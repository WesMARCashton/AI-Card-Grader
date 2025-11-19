
export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export const dataUrlToBase64 = (dataUrl: string): string => {
    if (!dataUrl) return '';
    const parts = dataUrl.split(',');
    if (parts.length > 1) {
        return parts[1];
    }
    // It might already be a base64 string
    return dataUrl; 
}

/**
 * Ensures that the image data string is a valid data URL.
 * If it's a raw base64 string, it prepends the necessary prefix.
 * If it's already a data URL, it returns it as is.
 * Handles null/undefined gracefully to prevent app crashes.
 * @param imageData The image data string (either base64 or a full data URL).
 * @returns A full data URL string or an empty string if input is invalid.
 */
export const ensureDataUrl = (imageData: string | null | undefined): string => {
    if (!imageData) return '';
    if (imageData.startsWith('data:')) {
        return imageData;
    }
    return `data:image/jpeg;base64,${imageData}`;
};
