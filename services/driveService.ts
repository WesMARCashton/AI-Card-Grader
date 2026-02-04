
import { CardData } from '../types';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_URL = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'card_collection.json';

const findFileId = async (accessToken: string): Promise<string | null> => {
  const q = `name='${FILE_NAME}' and trashed=false`;
  const url = `${DRIVE_API_URL}/files?spaces=drive,appDataFolder&fields=files(id,name)&q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=1`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  } catch (e) {
    console.error('Error finding file in Drive:', e);
    return null;
  }
};

export const getCollection = async (
  accessToken: string
): Promise<{ fileId: string | null; cards: CardData[] }> => {
  const fileId = await findFileId(accessToken);
  if (!fileId) return { fileId: null, cards: [] };

  try {
    const response = await fetch(`${DRIVE_API_URL}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { fileId: null, cards: [] };
    const cards = await response.json();
    return { fileId, cards: Array.isArray(cards) ? cards : [] };
  } catch (e) {
    console.error('Error downloading collection:', e);
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

  if (!fileId) metadata.parents = ['appDataFolder'];

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(cards)], { type: 'application/json' }));

  const url = fileId
    ? `${UPLOAD_API_URL}/files/${fileId}?uploadType=multipart`
    : `${UPLOAD_API_URL}/files?uploadType=multipart`;

  const response = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!response.ok) throw new Error('Failed to save to Drive.');
  const data = await response.json();
  return data.id;
};
