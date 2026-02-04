
import React, { useState, useEffect } from 'react';
import { CheckIcon, KeyIcon } from './icons';

interface SheetSettingsModalProps {
    onClose: () => void;
}

const SHEET_STORAGE_KEY = 'google_sheet_url';
const API_KEY_STORAGE_KEY = 'manual_gemini_api_key';

export const SheetSettingsModal: React.FC<SheetSettingsModalProps> = ({ onClose }) => {
    const [sheetUrl, setSheetUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [isSaved, setIsSaved] = useState(false);

    useEffect(() => {
        const savedUrl = localStorage.getItem(SHEET_STORAGE_KEY);
        const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
        if (savedUrl) setSheetUrl(savedUrl);
        if (savedKey) setApiKey(savedKey);
    }, []);

    const handleSave = () => {
        localStorage.setItem(SHEET_STORAGE_KEY, sheetUrl.trim());
        localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
        
        // Update process.env for the current session
        if (apiKey.trim()) {
            (process.env as any).API_KEY = apiKey.trim();
        }
        
        setIsSaved(true);
        setTimeout(() => {
            setIsSaved(false);
            onClose();
        }, 1000);
    };

    const handleManageApiKey = async () => {
        if (window.aistudio) {
            try {
                await window.aistudio.openSelectKey();
            } catch (e) {
                console.error("AI Studio key selection failed:", e);
                alert("Failed to open key selection. Please use manual entry.");
            }
        } else {
            alert("External key selection is not available in this environment. Please enter your key manually below.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-slate-800">App Settings</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-2xl">&times;</button>
                </div>

                <div className="space-y-6">
                    {/* API Key Section */}
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                        <h3 className="text-sm font-bold text-blue-800 flex items-center gap-2 mb-2">
                            <KeyIcon className="w-4 h-4" /> Grader API Connection
                        </h3>
                        <p className="text-xs text-blue-700 mb-4">
                            A Gemini API key from a paid project is required for the AI Grader to function.
                        </p>
                        
                        <div className="space-y-3">
                            <div>
                                <label htmlFor="manual-api-key" className="block text-xs font-medium text-slate-700 mb-1">Enter API Key Manually</label>
                                <input
                                    type="password"
                                    id="manual-api-key"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="AIzaSy..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                                />
                            </div>
                            
                            <div className="relative flex py-2 items-center">
                                <div className="flex-grow border-t border-blue-200"></div>
                                <span className="flex-shrink mx-4 text-[10px] text-blue-400 font-bold">OR</span>
                                <div className="flex-grow border-t border-blue-200"></div>
                            </div>

                            <button 
                                onClick={handleManageApiKey}
                                className="w-full py-2 px-4 bg-white border border-blue-200 hover:bg-blue-50 text-blue-600 text-xs font-bold rounded-md transition flex items-center justify-center gap-2"
                            >
                                <KeyIcon className="w-3 h-3" /> Use System Key Picker
                            </button>
                        </div>
                        
                        <a 
                            href="https://ai.google.dev/gemini-api/docs/billing" 
                            target="_blank" 
                            rel="noreferrer"
                            className="block text-[10px] text-blue-500 hover:underline mt-2 text-center"
                        >
                            Learn more about Gemini API billing
                        </a>
                    </div>

                    {/* Google Sheet Section */}
                    <div>
                        <label htmlFor="settings-sheet-url" className="block text-sm font-medium text-slate-700 mb-1">Google Sheet URL</label>
                        <input
                            type="url"
                            id="settings-sheet-url"
                            value={sheetUrl}
                            onChange={(e) => setSheetUrl(e.target.value)}
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                        />
                        <p className="text-[10px] text-slate-500 mt-2">The spreadsheet where your collection data will be synced.</p>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={onClose} className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-md transition text-sm">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className={`py-2 px-6 flex items-center justify-center gap-2 text-white font-bold rounded-md shadow-md transition text-sm ${isSaved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                        >
                            {isSaved ? <CheckIcon className="w-5 h-5" /> : 'Save Settings'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
