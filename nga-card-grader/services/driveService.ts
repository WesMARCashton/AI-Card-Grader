
import { CardData } from '../types';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_URL = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'card_collection.json';

// Helper to find the file in appDataFolder
const findFileId = async (accessToken: string): Promise<string | null> => {
    // Added 'and trashed=false' to ensure we don't pick up deleted files
    const response = await fetch(`${DRIVE_API_URL}/files?spaces=appDataFolder&fields=files(id,name)&q=name='${FILE_NAME}' and trashed=false`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) {
        const error = await response.json();
        console.error("Drive API findFileId error:", error);
        const message = error?.error?.message || 'Failed to search for collection file.';
        throw new Error(message);
    }
    const data = await response.json();
    return data.files.length > 0 ? data.files[0].id : null;
};

export const getCollection = async (accessToken: string): Promise<{ fileId: string | null, cards: CardData[] }> => {
    const fileId = await findFileId(accessToken);
    if (!fileId) {
        return { fileId: null, cards: [] };
    }

    const response = await fetch(`${DRIVE_API_URL}/files/${fileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (response.status === 404) {
        return { fileId: null, cards: [] }; // File might exist but be empty/deleted
    }
    if (!response.ok) {
        try {
            const error = await response.json();
            console.error("Drive API getCollection error:", error);
            const message = error?.error?.message || 'Failed to download collection file.';
            throw new Error(message);
        } catch(e) {
            console.error("Drive API getCollection error (non-JSON):", await response.text());
            throw new Error('Failed to download collection file.');
        }
    }
    
    try {
        const cards = await response.json();
        return { fileId, cards: Array.isArray(cards) ? cards : [] };
    } catch (e) {
        console.error("Error parsing collection JSON:", e);
        return { fileId, cards: [] }; // Return empty array if file is corrupted
    }
};

export const saveCollection = async (accessToken: string, fileId: string | null, cards: CardData[]): Promise<string> => {
    const metadata: { name: string, mimeType: string, parents?: string[] } = {
        name: FILE_NAME,
        mimeType: 'application/json',
    };
    
    // If we are creating a new file, specify appDataFolder as the parent.
    if (!fileId) {
        metadata.parents = ['appDataFolder'];
    }

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(cards)], { type: 'application/json' }));

    const url = fileId
        ? `${UPLOAD_API_URL}/files/${fileId}?uploadType=multipart`
        : `${UPLOAD_API_URL}/files?uploadType=multipart`;
    
    const method = fileId ? 'PATCH' : 'POST';

    const response = await fetch(url, {
        method,
        headers: { 'Authorization': `Bearer ${accessToken}` },
        body: form
    });

    if (!response.ok) {
        const error = await response.json();
        console.error("Drive API save error:", error);
        const message = error?.error?.message || 'Failed to save collection to Google Drive.';
        throw new Error(message);
    }

    const newFileData = await response.json();
    return newFileData.id;
};
