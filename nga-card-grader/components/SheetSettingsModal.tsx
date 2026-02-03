
import React, { useState, useEffect } from 'react';
import { CheckIcon } from './icons';

interface SheetSettingsModalProps {
    onClose: () => void;
}

const STORAGE_KEY = 'google_sheet_url';

export const SheetSettingsModal: React.FC<SheetSettingsModalProps> = ({ onClose }) => {
    const [sheetUrl, setSheetUrl] = useState('');
    const [isSaved, setIsSaved] = useState(false);

    useEffect(() => {
        const savedUrl = localStorage.getItem(STORAGE_KEY);
        if (savedUrl) setSheetUrl(savedUrl);
    }, []);

    const handleSave = () => {
        localStorage.setItem(STORAGE_KEY, sheetUrl.trim());
        setIsSaved(true);
        setTimeout(() => {
            setIsSaved(false);
            onClose();
        }, 1000);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-slate-800">Google Sheets Settings</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-2xl">&times;</button>
                </div>

                <div className="space-y-6">
                    <div>
                        <label htmlFor="settings-sheet-url" className="block text-sm font-medium text-slate-700 mb-1">Google Sheet URL</label>
                        <input
                            type="url"
                            id="settings-sheet-url"
                            value={sheetUrl}
                            onChange={(e) => setSheetUrl(e.target.value)}
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="text-xs text-slate-500 mt-2">Enter the URL of the Google Sheet where you want to sync your collection data.</p>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={onClose} className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-md transition">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!sheetUrl}
                            className={`py-2 px-4 flex items-center justify-center gap-2 text-white font-semibold rounded-md transition ${isSaved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                        >
                            {isSaved ? <CheckIcon className="w-5 h-5" /> : 'Save Settings'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
