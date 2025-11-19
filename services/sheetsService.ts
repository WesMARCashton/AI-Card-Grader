
import { CardData } from '../types';

const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

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
        console.error("Google Sheets API (get metadata) error:", error);
        throw new Error(error.error?.message || "Could not retrieve spreadsheet details. Check URL and permissions.");
    }

    const sheetMetaData = await sheetMetaResponse.json();
    if (!sheetMetaData.sheets || sheetMetaData.sheets.length === 0) {
        throw new Error("The specified spreadsheet contains no sheets.");
    }
    const firstSheetName = sheetMetaData.sheets[0].properties.title;

    // 2. Format the new card data into rows
    const newRows = cardsToSync.sort((a,b) => a.timestamp - b.timestamp).map(card => {
        // Safely handle potentially undefined strings
        const companyStr = (card.company || '').toString();
        const setStr = (card.set || '').toString();

        // Only hide the set name if it exactly matches the company name (e.g. Topps Topps)
        const set = companyStr.toUpperCase() === setStr.toUpperCase() ? '' : setStr;
        const cardNumber = card.cardNumber ? `#${card.cardNumber}` : '';
        
        // MAPPING UPDATE:
        // Col A: Year
        // Col B: Company
        // Col C: Set (Smart - hidden if matches company)
        // Col D: Name
        // Col E: Edition
        // Col F: Set (Raw - always included if exists)
        // Col G: Card Number
        // Col H: Grade Name (Status)
        // Col I: Overall Grade
        
        const stringValues = [
            card.year,
            card.company,
            set,
            card.name,
            card.edition,
            setStr, // Col F: Set
            cardNumber, // Col G
            card.gradeName, // Col H
        ].map(value => (value || '').toString().toUpperCase());

        return [
            ...stringValues,
            card.overallGrade, // Col I
        ];
    });

    // 3. Append the new data to the sheet. The API automatically finds the next empty row.
    const appendRange = `'${firstSheetName}'`;
    const appendResponse = await fetch(`${SHEETS_API_URL}/${spreadsheetId}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: newRows })
    });
    
    if (!appendResponse.ok) {
        const error = await appendResponse.json();
        console.error("Google Sheets API (append) error:", error);
        throw new Error(error.error?.message || "Failed to write data to the Google Sheet.");
    }
};
