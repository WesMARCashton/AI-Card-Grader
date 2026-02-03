
import { CardData } from '../types';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_URL = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'card_collection.json';

// Helper to find the *latest* file in appDataFolder (by modifiedTime)
const findFileId = async (accessToken: string): Promise<string | null> => {
  const q = `name='${FILE_NAME}' and trashed=false`;

  // Ask for modifiedTime and order by it so we pick the newest file if duplicates exist.
  const url =
    `${DRIVE_API_URL}/files` +
    `?spaces=appDataFolder` +
    `&fields=files(id,name,modifiedTime)` +
    `&q=${encodeURIComponent(q)}` +
    `&orderBy=modifiedTime desc` +
    `&pageSize=10`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('Drive API findFileId error:', error);
    const message = (error as any)?.error?.message || 'Failed to search for collection file.';
    throw new Error(message);
  }

  const data = await response.json();
  const files = Array.isArray(data?.files) ? data.files : [];
  console.log(`[DriveService] Found ${files.length} collection files.`);
  return files.length > 0 ? files[0].id : null;
};

export const getCollection = async (
  accessToken: string
): Promise<{ fileId: string | null; cards: CardData[] }> => {
  const fileId = await findFileId(accessToken);
  if (!fileId) {
    console.log("[DriveService] No existing collection file found in Google Drive.");
    return { fileId: null, cards: [] };
  }

  const response = await fetch(`${DRIVE_API_URL}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return { fileId: null, cards: [] };
  }
  if (!response.ok) {
    try {
      const error = await response.json();
      console.error('Drive API getCollection error:', error);
      const message = (error as any)?.error?.message || 'Failed to download collection file.';
      throw new Error(message);
    } catch (e) {
      console.error('Drive API getCollection error (non-JSON):', await response.text());
      throw new Error('Failed to download collection file.');
    }
  }

  try {
    const cards = await response.json();
    console.log(`[DriveService] Successfully parsed ${Array.isArray(cards) ? cards.length : 0} cards from JSON.`);
    return { fileId, cards: Array.isArray(cards) ? cards : [] };
  } catch (e) {
    console.error('Error parsing collection JSON:', e);
    return { fileId, cards: [] };
  }
};

export const saveCollection = async (
  accessToken: string,
  fileId: string | null,
  cards: CardData[]
): Promise<string> => {
  const metadata: { name: string; mimeType: string; parents?: string[] } = {
    name: FILE_NAME,
    mimeType: 'application/json',
  };

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
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('Drive API save error:', error);
    const message = (error as any)?.error?.message || 'Failed to save collection to Google Drive.';
    throw new Error(message);
  }

  const newFileData = await response.json();
  console.log(`[DriveService] Collection saved. New File ID: ${newFileData.id}`);
  return newFileData.id;
};
