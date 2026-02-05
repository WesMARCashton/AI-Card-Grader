
import React, { useState, useEffect } from 'react';
import { CheckIcon, KeyIcon, SpinnerIcon, ResyncIcon, LinkIcon } from './icons';
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
        if (cleanKey) (process.env as any).API_KEY = cleanKey;
        setIsSaved(true);
        setTimeout(() => { setIsSaved(false); onClose(); }, 1000);
    };

    const handleTestKey = async () => {
        if (!apiKey.trim()) return;
        setTestStatus({ loading: true });
        const oldKey = (process.env as any).API_KEY;
        (process.env as any).API_KEY = apiKey.trim();
        const result = await testConnection();
        setTestStatus({ loading: false, result: result.message, success: result.success });
        if (!isSaved) (process.env as any).API_KEY = oldKey;
    };

    const isQuotaError = testStatus.result?.includes('429') || testStatus.result?.includes('quota');
    const isDisabledError = testStatus.result?.includes('403') || testStatus.result?.includes('DISABLED');

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-slate-800">App Settings</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-2xl">&times;</button>
                </div>

                <div className="space-y-6">
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                        <h3 className="text-sm font-bold text-blue-800 flex items-center gap-2 mb-2">
                            <KeyIcon className="w-4 h-4" /> Gemini AI Connection
                        </h3>
                        
                        <div className="space-y-3">
                            {isDisabledError && (
                                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-700 font-medium">
                                    <strong className="block text-xs mb-1">🚫 API Not Enabled!</strong>
                                    Your API key is working, but the **Generative Language API** is disabled for your project.
                                    <div className="mt-2">
                                        <a 
                                            href="https://console.developers.google.com/apis/api/generativelanguage.googleapis.com/overview" 
                                            target="_blank" 
                                            className="inline-block bg-amber-600 text-white px-3 py-1.5 rounded font-bold hover:bg-amber-700 transition"
                                        >
                                            Enable API Now
                                        </a>
                                        <p className="mt-2 text-[10px]">After enabling, wait 60 seconds for Google to sync.</p>
                                    </div>
                                </div>
                            )}

                            {isQuotaError && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded text-[11px] text-red-700 font-medium">
                                    <strong className="block text-xs mb-1">⚠️ Quota/Daily Limit Hit!</strong>
                                    You have exceeded the **20 requests per day** limit of the Free Tier.
                                    <div className="mt-2 space-y-1">
                                        <p>1. Open <a href="https://console.cloud.google.com/billing" target="_blank" className="underline font-bold">Google Cloud Billing</a></p>
                                        <p>2. Link your Project to a billing account (Credit Card).</p>
                                    </div>
                                </div>
                            )}

                            {!isQuotaError && !isDisabledError && (
                                <div className="p-3 bg-white border border-blue-200 rounded text-[11px] text-blue-700 font-medium">
                                    <strong>💡 Paid Account Setup:</strong>
                                    <p className="mt-1">Ensure the 'Generative Language API' is enabled in your Google Cloud Console for the project linked to your API key.</p>
                                </div>
                            )}

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
                                    <button onClick={handleTestKey} disabled={testStatus.loading || !apiKey.trim()} className="px-3 py-2 bg-white border border-blue-300 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50 transition shadow-sm flex items-center gap-1 text-xs font-bold">
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
                        </div>
                        
                        <div className="mt-4 flex flex-col gap-2">
                            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline font-bold flex items-center justify-center gap-1">
                                <LinkIcon className="w-3 h-3" /> Get API Key (AI Studio)
                            </a>
                            <a href="https://console.developers.google.com/apis/api/generativelanguage.googleapis.com/overview" target="_blank" rel="noreferrer" className="text-[10px] text-slate-500 hover:underline font-bold flex items-center justify-center gap-1">
                                <LinkIcon className="w-3 h-3" /> Enable Gemini API
                            </a>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="settings-sheet-url" className="block text-sm font-medium text-slate-700 mb-1">Google Sheet URL</label>
                        <input type="url" id="settings-sheet-url" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm" />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={onClose} className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-md transition text-sm">Cancel</button>
                        <button onClick={handleSave} className={`py-2 px-6 flex items-center justify-center gap-2 text-white font-bold rounded-md shadow-md transition text-sm ${isSaved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
                            {isSaved ? <CheckIcon className="w-5 h-5" /> : 'Save Settings'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
