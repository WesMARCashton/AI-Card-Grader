
import React, { useState, useEffect } from 'react';
import { CheckIcon, KeyIcon, SpinnerIcon, ResyncIcon } from './icons';
import { testConnection } from '../services/geminiService';

interface SheetSettingsModalProps {
    onClose: () => void;
}

const SHEET_STORAGE_KEY = 'google_sheet_url';
const API_KEY_STORAGE_KEY = 'manual_gemini_api_key';

export const SheetSettingsModal: React.FC<SheetSettingsModalProps> = ({ onClose }) => {
    const [sheetUrl, setSheetUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [isSaved, setIsSaved] = useState(false);
    const [testStatus, setTestStatus] = useState<{ loading: boolean; result?: string; success?: boolean }>({ loading: false });

    useEffect(() => {
        const savedUrl = localStorage.getItem(SHEET_STORAGE_KEY);
        const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
        if (savedUrl) setSheetUrl(savedUrl);
        if (savedKey) setApiKey(savedKey);
    }, []);

    const handleSave = () => {
        const cleanKey = apiKey.trim();
        const cleanUrl = sheetUrl.trim();
        
        localStorage.setItem(SHEET_STORAGE_KEY, cleanUrl);
        localStorage.setItem(API_KEY_STORAGE_KEY, cleanKey);
        
        if (cleanKey) {
            (process.env as any).API_KEY = cleanKey;
        }
        
        setIsSaved(true);
        setTimeout(() => {
            setIsSaved(false);
            onClose();
        }, 1000);
    };

    const handleTestKey = async () => {
        if (!apiKey.trim()) return;
        setTestStatus({ loading: true });
        
        // Temporarily set the key for the test if it hasn't been saved yet
        const oldKey = (process.env as any).API_KEY;
        (process.env as any).API_KEY = apiKey.trim();
        
        const result = await testConnection();
        setTestStatus({ loading: false, result: result.message, success: result.success });
        
        // Restore key if it was just a temporary test
        if (!isSaved) (process.env as any).API_KEY = oldKey;
    };

    const handleManageApiKey = async () => {
        if (window.aistudio) {
            try {
                await window.aistudio.openSelectKey();
            } catch (e) {
                console.error("AI Studio key selection failed:", e);
                alert("Failed to open key selection. Please use manual entry below.");
            }
        } else {
            alert("System key picker is not available in this host.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
                        
                        <div className="space-y-3">
                            <div>
                                <label htmlFor="manual-api-key" className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Enter API Key Manually</label>
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        id="manual-api-key"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="AIzaSy..."
                                        className="flex-grow px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                                    />
                                    <button 
                                        onClick={handleTestKey}
                                        disabled={testStatus.loading || !apiKey.trim()}
                                        className="px-3 py-2 bg-white border border-blue-300 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50 transition shadow-sm flex items-center gap-1 text-xs font-bold"
                                    >
                                        {testStatus.loading ? <SpinnerIcon className="w-4 h-4" /> : <ResyncIcon className="w-4 h-4" />}
                                        Test
                                    </button>
                                </div>
                            </div>

                            {testStatus.result && (
                                <div className={`p-2 rounded text-[10px] font-medium border ${testStatus.success ? 'bg-green-100 border-green-200 text-green-800' : 'bg-red-100 border-red-200 text-red-800'}`}>
                                    {testStatus.result}
                                </div>
                            )}
                            
                            <div className="relative flex py-1 items-center">
                                <div className="flex-grow border-t border-blue-200"></div>
                                <span className="flex-shrink mx-4 text-[9px] text-blue-400 font-bold">OR</span>
                                <div className="flex-grow border-t border-blue-200"></div>
                            </div>

                            <button 
                                onClick={handleManageApiKey}
                                className="w-full py-2 px-4 bg-white border border-blue-200 hover:bg-blue-50 text-blue-600 text-xs font-bold rounded-md transition flex items-center justify-center gap-2"
                            >
                                <KeyIcon className="w-3 h-3" /> Select via AI Studio
                            </button>
                        </div>
                        
                        <a 
                            href="https://ai.google.dev/gemini-api/docs/billing" 
                            target="_blank" 
                            rel="noreferrer"
                            className="block text-[10px] text-blue-500 hover:underline mt-2 text-center"
                        >
                            Learn about Billing & Quotas
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
