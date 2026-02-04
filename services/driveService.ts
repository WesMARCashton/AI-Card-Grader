import { CardData } from '../types';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_URL = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'card_collection.json';

// Helper to find the file in appDataFolder (recovers if it was trashed)
const findFileId = async (accessToken: string): Promise<string | null> => {
      const base = `${DRIVE_API_URL}/files?spaces=appDataFolder&fields=files(id,name,trashed)`;

      // 1) Try non-trashed first
      const q1 = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
      let response = await fetch(`${base}&q=${q1}`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              console.error("Drive API findFileId error:", error);
              const message = (error as any)?.error?.message || 'Failed to search for collection file.';
              throw new Error(message);
      }

      let data = await response.json();
      if (data.files && data.files.length > 0) return data.files[0].id;

      // 2) If not found, try INCLUDING trashed
      const q2 = encodeURIComponent(`name='${FILE_NAME}'`);
      response = await fetch(`${base}&q=${q2}`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              console.error("Drive API findFileId (trashed check) error:", error);
              return null;
      }

      data = await response.json();
      if (!data.files || data.files.length === 0) return null;

      const file = data.files[0];

      // 3) If it exists but is trashed, untrash it
      if (file.trashed) {
              const untrashResp = await fetch(`${DRIVE_API_URL}/files/${file.id}`, {
                        method: 'PATCH',
                        headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ trashed: false })
              });

        if (!untrashResp.ok) {
                  const err = await untrashResp.json().catch(() => ({}));
                  console.error("Drive API untrash error:", err);
                  // Even if untrash fails, return id so user can try manually later
        }
      }

      return file.id;
};

export const listCollectionsFromDrive = async (accessToken: string): Promise<CardData[]> => {
      try {
              const fileId = await findFileId(accessToken);
              if (!fileId) {
                        throw new Error('Collection file not found in Drive.');
              }

        const response = await fetch(
                  `${DRIVE_API_URL}/files/${fileId}?alt=media`,
            {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
            }
                );

        if (!response.ok) {
                  const error = await response.json().catch(() => ({}));
                  console.error("Drive API download error:", error);
                  const message = (error as any)?.error?.message || 'Failed to download collection file.';
                  throw new Error(message);
        }

        const data = await response.json();
              return data.cards && Array.isArray(data.cards) ? data.cards : [];
      } catch (error) {
              throw new Error(error instanceof Error ? error.message : 'Failed to load collection from Drive.');
      }
};

export const saveCollectionToDrive = async (
      accessToken: string,
      cards: CardData[]
    ): Promise<void> => {
      try {
              const fileId = await findFileId(accessToken);
              const fileData = { cards };
              const jsonContent = JSON.stringify(fileData);

        if (fileId) {
                  // File exists, update it
                const response = await fetch(
                            `${UPLOAD_API_URL}/files/${fileId}?uploadType=media`,
                    {
                                  method: 'PATCH',
                                  headers: {
                                                  'Authorization': `Bearer ${accessToken}`,
                                                  'Content-Type': 'application/json'
                                  },
                                  body: jsonContent
                    }
                          );

                if (!response.ok) {
                            const error = await response.json().catch(() => ({}));
                            console.error("Drive API PATCH error:", error);
                            throw new Error((error as any)?.error?.message || 'Failed to update collection file.');
                }
        } else {
                  // File doesn't exist, create it
                const metadata = {
                            name: FILE_NAME,
                            parents: ['appDataFolder']
                };

                const formData = new FormData();
                  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                  formData.append('file', new Blob([jsonContent], { type: 'application/json' }));

                const response = await fetch(
                            `${UPLOAD_API_URL}/files?uploadType=multipart`,
                    {
                                  method: 'POST',
                                  headers: {
                                                  'Authorization': `Bearer ${accessToken}`
                                  },
                                  body: formData
                    }
                          );

                if (!response.ok) {
                            const error = await response.json().catch(() => ({}));
                            console.error("Drive API POST error:", error);
                            throw new Error((error as any)?.error?.message || 'Failed to create collection file.');
                }
        }
      } catch (error) {
              throw new Error(error instanceof Error ? error.message : 'Failed to save collection to Drive.');
      }
};
