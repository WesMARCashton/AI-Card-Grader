
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
    return dataUrl; 
}

/**
 * Resizes an image to a smaller footprint.
 * Lowering from 1024 to 800 significantly reduces Token usage in Gemini.
 */
export const optimizeImageForGemini = async (dataUrl: string, maxWidth = 800): Promise<string> => {
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
            // 0.7 quality is sufficient for card identification but much smaller in size
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
};

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
