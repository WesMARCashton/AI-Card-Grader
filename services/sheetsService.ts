
import { CardData } from '../types';

const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Column Mapping (A-Z):
 * A - Year (year)
 * B - Company (company)
 * C - Series (team)
 * D - Name (name)
 * E - Edition (edition)
 * F - Set (set)
 * G - Card Number (cardNumber)
 * H - Mint (gradeName)
 * I - Final Grade (overallGrade)
 * J - [BLANK]
 * K - [BLANK]
 * L - Centering Grade
 * M - Centering Notes
 * N - Corners Grade
 * O - Corners Notes
 * P - Edges Grade
 * Q - Edges Notes
 * R - Surface Grade
 * S - Surface Notes
 * T - Print Quality Grade
 * U - Print Quality Notes
 * V - Summary
 * W - [BLANK]
 * X - [BLANK]
 * Y - [BLANK]
 * Z - [BLANK]
 */
const SHEET_HEADERS = [
    'YEAR', 'COMPANY', 'SERIES', 'NAME', 'EDITION', 'SET', 'NUMBER', 'MINT', 'GRADE',
    '', '', // J, K
    'CENTERING GRADE', 'CENTERING NOTES',
    'CORNERS GRADE', 'CORNERS NOTES',
    'EDGES GRADE', 'EDGES NOTES',
    'SURFACE GRADE', 'SURFACE NOTES',
    'PRINT QUALITY GRADE', 'PRINT QUALITY NOTES',
    'SUMMARY',
    '', '', '', '' // W, X, Y, Z
];

const getSheetIdFromUrl = (url: string): string | null => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
};

export const syncToSheet = async (accessToken: string, sheetUrl: string, cardsToSync: CardData[]): Promise<void> => {
    const spreadsheetId = getSheetIdFromUrl(sheetUrl);
    if (!spreadsheetId) {
        throw new Error("Invalid Google Sheet URL. Please provide a valid URL.");
    }

    if (cardsToSync.length === 0) {
        return;
    }
    
    // 1. Get spreadsheet title
    const sheetMetaResponse = await fetch(`${SHEETS_API_URL}/${spreadsheetId}?fields=sheets(properties.title)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!sheetMetaResponse.ok) {
        const error = await sheetMetaResponse.json();
        throw new Error(error.error?.message || "Could not retrieve spreadsheet details.");
    }

    const sheetMetaData = await sheetMetaResponse.json();
    const firstSheetName = sheetMetaData.sheets[0].properties.title;

    // 2. Check for existing content
    const checkResponse = await fetch(`${SHEETS_API_URL}/${spreadsheetId}/values/'${encodeURIComponent(firstSheetName)}'!A1:A1`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    
    const checkData = await checkResponse.json();
    const needsHeaders = !checkData.values || checkData.values.length === 0;

    // 3. Prepare rows
    const rowsToAppend = [];
    if (needsHeaders) {
        rowsToAppend.push(SHEET_HEADERS);
    }

    const newRows = cardsToSync.sort((a,b) => a.timestamp - b.timestamp).map(card => {
        const d = card.details;
        return [
            (card.year || '').toString(),           // A
            (card.company || '').toUpperCase(),      // B
            (card.team || '').toUpperCase(),         // C
            (card.name || '').toUpperCase(),         // D
            (card.edition || '').toUpperCase(),      // E
            (card.set || '').toUpperCase(),          // F
            card.cardNumber ? `#${card.cardNumber}` : '', // G
            (card.gradeName || '').toUpperCase(),    // H
            card.overallGrade,                       // I
            '',                                      // J
            '',                                      // K
            d?.centering?.grade,                     // L
            d?.centering?.notes,                     // M
            d?.corners?.grade,                       // N
            d?.corners?.notes,                       // O
            d?.edges?.grade,                         // P
            d?.edges?.notes,                         // Q
            d?.surface?.grade,                       // R
            d?.surface?.notes,                       // S
            d?.printQuality?.grade,                  // T
            d?.printQuality?.notes,                  // U
            card.summary || '',                      // V
            '',                                      // W
            '',                                      // X
            '',                                      // Y
            ''                                       // Z
        ];
    });

    rowsToAppend.push(...newRows);

    // 4. Send to Google Sheets
    const appendRange = `'${firstSheetName}'!A1`;
    const appendResponse = await fetch(`${SHEETS_API_URL}/${spreadsheetId}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: rowsToAppend })
    });
    
    if (!appendResponse.ok) {
        const error = await appendResponse.json();
        throw new Error(error.error?.message || "Failed to write data to Google Sheet.");
    }
};
