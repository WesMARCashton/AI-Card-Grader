
import React, { useState, useEffect } from 'react';
import { CardData } from '../types';
import { syncToSheet } from '../services/sheetsService';
import { SpinnerIcon, CheckIcon } from './icons';

interface SyncSheetModalProps {
    cardsToSync: CardData[];
    onClose: () => void;
    getAccessToken: () => Promise<string>;
    onSyncSuccess: (syncedCards: CardData[]) => void;
    userName: string;
}

const STORAGE_KEY = 'google_sheet_url';

export const SyncSheetModal: React.FC<SyncSheetModalProps> = ({ cardsToSync, onClose, getAccessToken, onSyncSuccess, userName }) => {
    const [sheetUrl, setSheetUrl] = useState('');
    const [status, setStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        const savedUrl = localStorage.getItem(STORAGE_KEY);
        if (savedUrl) {
            setSheetUrl(savedUrl);
        }
    }, []);

    const handleSync = async () => {
        const cleanUrl = sheetUrl.trim();
        if (!cleanUrl || !cleanUrl.includes('spreadsheets/d/')) {
            setErrorMessage("Please enter a valid Google Sheet URL.");
            setStatus('error');
            return;
        }
        
        setStatus('syncing');
        setErrorMessage('');
        
        try {
            // Update storage immediately so the latest URL is used by all services
            localStorage.setItem(STORAGE_KEY, cleanUrl);
            
            const token = await getAccessToken();
            // Pass the fresh URL and user name to the service
            await syncToSheet(token, cleanUrl, cardsToSync, userName);
            
            onSyncSuccess(cardsToSync); 
            setStatus('success');
            
            setTimeout(onClose, 2000);
        } catch (err: any) {
            console.error("Sync to sheet failed:", err);
            setErrorMessage(err.message || "An unknown error occurred.");
            setStatus('error');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-slate-800">Sync to Google Sheet</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-2xl">&times;</button>
                </div>

                <div className="space-y-4">
                    <p className="text-sm text-slate-600">
                        Cards will be added starting from Column A (YEAR).
                    </p>
                    <div>
                        <label htmlFor="sheet-url" className="block text-sm font-medium text-slate-700 mb-1">Google Sheet URL</label>
                        <input
                            type="url"
                            id="sheet-url"
                            value={sheetUrl}
                            onChange={(e) => setSheetUrl(e.target.value)}
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            disabled={status === 'syncing' || status === 'success'}
                        />
                    </div>

                    {status === 'error' && (
                        <div className="bg-red-100 text-red-700 p-3 rounded-md text-sm border border-red-200">
                            <strong>Sync Failed:</strong> {errorMessage}
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="bg-green-100 text-green-700 p-3 rounded-md text-sm border border-green-200 flex items-center gap-2">
                            <CheckIcon className="w-5 h-5" />
                            <span>Successfully synced {cardsToSync.length} cards!</span>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-md transition"
                            disabled={status === 'syncing'}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSync}
                            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-md shadow-md transition disabled:opacity-50 flex items-center gap-2"
                            disabled={status === 'syncing' || status === 'success' || cardsToSync.length === 0}
                        >
                            {status === 'syncing' ? <SpinnerIcon className="w-5 h-5" /> : null}
                            {status === 'syncing' ? 'Syncing...' : `Sync ${cardsToSync.length} Cards`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
