import React, { useState } from 'react';
import { CheckIcon } from './icons';

interface ApiKeyModalProps {
    onSave: (key: string) => void;
    onClose: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onSave, onClose }) => {
    const [apiKey, setApiKey] = useState('');

    const handleSave = () => {
        if (apiKey.trim()) {
            onSave(apiKey.trim());
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-[60] p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-slate-800 mb-2">Enter Gemini API Key</h2>
                <p className="text-sm text-slate-600 mb-4">
                    The app couldn't find an API key from the server. Please enter your key manually to enable grading.
                </p>
                
                <div className="mb-4">
                    <label htmlFor="api-key" className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
                    <input
                        type="text"
                        id="api-key"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                        This key will be saved in your browser's local storage.
                    </p>
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-md transition"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!apiKey.trim()}
                        className="flex items-center gap-2 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition disabled:opacity-50"
                    >
                        <CheckIcon className="w-4 h-4" />
                        Save Key
                    </button>
                </div>
            </div>
        </div>
    );
};