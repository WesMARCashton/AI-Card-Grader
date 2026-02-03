import React, { useState, useEffect } from 'react';
import { SpinnerIcon } from './icons';

interface ManualGradeModalProps {
    initialGrade: number;
    initialGradeName: string;
    onSave: (grade: number, gradeName: string) => void;
    onClose: () => void;
    isSaving: boolean;
    savingStatus: string;
}

const gradeMap: { [key: number]: string } = {
    10: 'GEM MT',
    9.5: 'MINT+',
    9: 'MINT',
    8.5: 'NM-MT+',
    8: 'NM-MT',
    7.5: 'NM+',
    7: 'NM',
    6.5: 'EX-MT+',
    6: 'EX-MT',
    5.5: 'EX+',
    5: 'EX',
    4.5: 'VG-EX+',
    4: 'VG-EX',
    3.5: 'VG+',
    3: 'VG',
    2.5: 'GOOD+',
    2: 'GOOD',
    1.5: 'FAIR',
    1: 'POOR'
};


const getGradeName = (grade: number | ''): string => {
    if (grade === '') return '';
    return gradeMap[grade] || 'Custom Grade';
};


export const ManualGradeModal: React.FC<ManualGradeModalProps> = ({ initialGrade, initialGradeName, onSave, onClose, isSaving, savingStatus }) => {
    const [grade, setGrade] = useState<number | ''>(initialGrade);
    const [gradeName, setGradeName] = useState(initialGradeName);

    useEffect(() => {
        // Automatically update the grade name when the numeric grade changes.
        if (typeof grade === 'number') {
            const suggestedName = getGradeName(grade);
            setGradeName(suggestedName);
        }
    }, [grade]);


    const handleSave = () => {
        if (typeof grade === 'number' && grade >= 1 && grade <= 10 && gradeName.trim()) {
            onSave(grade, gradeName.trim());
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-slate-800 mb-4">Manual Grade Entry</h2>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="grade-number" className="block text-sm font-medium text-slate-700 mb-1">Overall Grade (1-10)</label>
                        <input
                            type="number"
                            id="grade-number"
                            value={grade}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                    setGrade('');
                                    return;
                                }
                                const num = parseFloat(val);
                                if (!isNaN(num)) {
                                    setGrade(Math.max(1, Math.min(10, num)));
                                }
                            }}
                            min="1"
                            max="10"
                            step="0.5"
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50"
                            disabled={isSaving}
                        />
                    </div>
                    <div>
                        <label htmlFor="grade-name" className="block text-sm font-medium text-slate-700 mb-1">Grade Name</label>
                        <input
                            type="text"
                            id="grade-name"
                            value={gradeName}
                            onChange={(e) => setGradeName(e.target.value)}
                            placeholder="e.g., Mint, Near Mint"
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50"
                            disabled={isSaving}
                        />
                    </div>
                </div>
                <div className="flex justify-end gap-3 pt-6">
                    <button onClick={onClose} className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-md transition" disabled={isSaving}>
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={typeof grade !== 'number' || !gradeName.trim() || isSaving}
                        className="py-2 px-4 min-w-[11rem] flex justify-center items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition disabled:opacity-50 disabled:cursor-wait"
                    >
                        {isSaving ? (
                            <>
                                <SpinnerIcon className="w-5 h-5 mr-2 flex-shrink-0" />
                                <span className="min-w-0 text-center break-words">{savingStatus || 'Regenerating...'}</span>
                            </>
                        ) : (
                            'Save & Rewrite Analysis'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};