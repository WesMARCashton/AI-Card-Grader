
import { CardData, EvaluationDetails, SubGradeDetail } from '../types';

const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

const SHEET_HEADERS = [
    'YEAR', 
    'COMPANY', 
    'SERIES', 
    'NAME', 
    'EDITION', 
    'SET', 
    'CARD_NUMBER', 
    'MINT_LABEL', 
    'GRADE',
    '', // Column J: Empty as requested
    '', // Column K: Empty as requested
    'CENTERING GRADE', 'CENTERING NOTES',
    'CORNERS GRADE', 'CORNERS NOTES',
    'EDGES GRADE', 'EDGES NOTES',
    'SURFACE GRADE', 'SURFACE NOTES',
    'PRINT QUALITY GRADE', 'PRINT QUALITY NOTES',
    'SUMMARY'
];

const getSheetIdFromUrl = (url: string): string | null => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
};

export const syncToSheet = async (accessToken: string, sheetUrl: string, cardsToSync: CardData[], userName: string): Promise<void> => {
    const spreadsheetId = getSheetIdFromUrl(sheetUrl);
    if (!spreadsheetId) throw new Error("Invalid Google Sheet URL.");

    const sheetMetaResponse = await fetch(`${SHEETS_API_URL}/${spreadsheetId}?fields=sheets(properties.title)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const sheetMetaData = await sheetMetaResponse.json();
    const firstSheetName = sheetMetaData.sheets[0].properties.title;

    const checkResponse = await fetch(`${SHEETS_API_URL}/${spreadsheetId}/values/'${encodeURIComponent(firstSheetName)}'!A1:A1`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const checkData = await checkResponse.json();
    const needsHeaders = !checkData.values || checkData.values.length === 0;

    const rowsToAppend: any[][] = needsHeaders ? [SHEET_HEADERS] : [];
    const newRows = cardsToSync.map(card => {
        const d = card.details;
        return [
            card.year || '', 
            (card.company || '').toUpperCase(),      // Column B
            (card.team || '').toUpperCase(),         // Column C
            (card.name || '').toUpperCase(),         // Column D
            (card.edition || '').toUpperCase(),      // Column E
            (card.set || '').toUpperCase(),          // Column F
            (card.cardNumber || '').toUpperCase(),   // Column G
            (card.gradeName || '').toUpperCase(),    // Column H
            card.overallGrade,
            '', // Column J: empty
            '', // Column K: empty
            d?.centering?.grade, d?.centering?.notes,
            d?.corners?.grade, d?.corners?.notes,
            d?.edges?.grade, d?.edges?.notes,
            d?.surface?.grade, d?.surface?.notes,
            d?.printQuality?.grade, d?.printQuality?.notes,
            card.summary || ''
        ];
    });
    rowsToAppend.push(...newRows);

    await fetch(`${SHEETS_API_URL}/${spreadsheetId}/values/${encodeURIComponent(firstSheetName)}!A1:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rowsToAppend })
    });
};

/**
 * Fetches data from the Master Sheet and reconstructs CardData objects.
 */
export const fetchCardsFromSheet = async (accessToken: string, sheetUrl: string): Promise<CardData[]> => {
    const spreadsheetId = getSheetIdFromUrl(sheetUrl);
    if (!spreadsheetId) throw new Error("Invalid Google Sheet URL.");

    // Fetching A:V which contains 22 columns of data
    const response = await fetch(`${SHEETS_API_URL}/${spreadsheetId}/values/A:V`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error("Could not load Master Sheet data.");
    
    const data = await response.json();
    if (!data.values || data.values.length <= 1) return [];

    // Filter out rows that are entirely empty or clearly not card data (header rows that aren't the first)
    return data.values.slice(1)
        .filter((row: any[]) => row.length > 3 && (row[3] || row[0])) // Must have Name or Year
        .map((row: any[], index: number) => {
            const details: EvaluationDetails = {
                centering: { grade: parseFloat(row[11]), notes: row[12] || '' },
                corners: { grade: parseFloat(row[13]), notes: row[14] || '' },
                edges: { grade: parseFloat(row[15]), notes: row[16] || '' },
                surface: { grade: parseFloat(row[17]), notes: row[18] || '' },
                printQuality: { grade: parseFloat(row[19]), notes: row[20] || '' },
            };

            return {
                id: `sheet-${index}-${Date.now()}`,
                status: 'reviewed',
                year: row[0] || '',
                company: row[1] || '',
                team: row[2] || '',
                name: row[3] || '',
                edition: row[4] || '',
                set: row[5] || '',
                cardNumber: row[6] || '',
                gradeName: row[7] || '',
                overallGrade: parseFloat(row[8]) || 0,
                scannedBy: row[9] || 'Sheet Import',
                timestamp: row[10] ? (isNaN(new Date(row[10]).getTime()) ? Date.now() : new Date(row[10]).getTime()) : Date.now(),
                details,
                summary: row[21] || '',
                gradingSystem: 'NGA',
                isSynced: true,
                frontImage: '', 
                backImage: ''
            } as CardData;
        });
};
