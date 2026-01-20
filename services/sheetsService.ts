import { CardData } from '../types';

const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

// Header definitions for the Google Sheet
const SHEET_HEADERS = [
    'YEAR', 'COMPANY', 'SET', 'NAME', 'EDITION', 'NUMBER', 'GRADE NAME', 'GRADE',
    'CENTERING GRADE', 'CENTERING NOTES',
    'CORNERS GRADE', 'CORNERS NOTES',
    'EDGES GRADE', 'EDGES NOTES',
    'SURFACE GRADE', 'SURFACE NOTES',
    'PRINT QUALITY GRADE', 'PRINT QUALITY NOTES',
    'SUMMARY', 'ESTIMATED VALUE', 'SOURCES'
];

// Extracts the spreadsheet ID from a Google Sheet URL
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
        return; // Nothing to sync
    }
    
    // 1. Get spreadsheet metadata to find the name of the very first sheet.
    const sheetMetaResponse = await fetch(`${SHEETS_API_URL}/${spreadsheetId}?fields=sheets(properties.title)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!sheetMetaResponse.ok) {
        const error = await sheetMetaResponse.json();
        throw new Error(error.error?.message || "Could not retrieve spreadsheet details. Check URL and permissions.");
    }

    const sheetMetaData = await sheetMetaResponse.json();
    const firstSheetName = sheetMetaData.sheets[0].properties.title;

    // 2. Check if the sheet is empty to decide if we need headers
    const checkResponse = await fetch(`${SHEETS_API_URL}/${spreadsheetId}/values/'${encodeURIComponent(firstSheetName)}'!A1:A1`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    
    const checkData = await checkResponse.json();
    const needsHeaders = !checkData.values || checkData.values.length === 0;

    // 3. Format the data into rows
    const rowsToAppend = [];
    
    if (needsHeaders) {
        rowsToAppend.push(SHEET_HEADERS);
    }

    const newRows = cardsToSync.sort((a,b) => a.timestamp - b.timestamp).map(card => {
        const company = (card.company || '').toString();
        const cardSet = (card.set || '').toString();
        const set = company.toUpperCase() === cardSet.toUpperCase() ? '' : cardSet;
        const cardNumber = card.cardNumber ? `#${card.cardNumber}` : '';
        
        const stringValues = [
            card.year,
            company,
            set,
            card.name,
            card.edition,
            cardNumber,
            card.gradeName,
        ].map(value => (value || '').toString().toUpperCase());

        const d = card.details;
        const subgrades = [
            d?.centering?.grade, d?.centering?.notes,
            d?.corners?.grade, d?.corners?.notes,
            d?.edges?.grade, d?.edges?.notes,
            d?.surface?.grade, d?.surface?.notes,
            d?.printQuality?.grade, d?.printQuality?.notes,
        ];

        const marketVal = card.marketValue ? `${card.marketValue.currency} ${card.marketValue.averagePrice}` : 'N/A';
        const sources = card.marketValue?.sourceUrls.map(s => s.uri).join(', ') || '';

        return [
            ...stringValues,
            card.overallGrade, 
            ...subgrades,
            card.summary || '',
            marketVal,
            sources
        ];
    });

    rowsToAppend.push(...newRows);

    // 4. Append the data
    const appendRange = `'${firstSheetName}'`;
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
        throw new Error(error.error?.message || "Failed to write data to the Google Sheet.");
    }
};