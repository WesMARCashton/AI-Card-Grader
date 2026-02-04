
export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export const dataUrlToBase64 = (dataUrl: string): string => {
    if (!dataUrl || typeof dataUrl !== 'string') return '';
    const parts = dataUrl.split(',');
    if (parts.length > 1) {
        return parts[1];
    }
    // It might already be a base64 string
    return dataUrl; 
}

/**
 * Resizes an image (dataUrl) to a maximum width to reduce payload size for the Gemini API.
 * This helps stay within Tokens Per Minute (TPM) limits and prevents 429 errors.
 */
export const optimizeImageForGemini = async (dataUrl: string, maxWidth = 1024): Promise<string> => {
    if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
    
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(dataUrl);
                return;
            }
            
            ctx.drawImage(img, 0, 0, width, height);
            // Use JPEG at 0.8 quality for a good balance of detail and file size
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
};

/**
 * Ensures that the image data string is a valid data URL.
 */
export const ensureDataUrl = (imageData: any): string => {
    if (imageData === null || imageData === undefined || typeof imageData !== 'string') {
        return '';
    }
    
    if (imageData.startsWith('data:')) {
        return imageData;
    }
    if (imageData.length > 0) {
        return `data:image/jpeg;base64,${imageData}`;
    }
    return '';
};
