
import React, { useState, useEffect } from 'react';
import { SpinnerIcon, ResyncIcon } from './icons';
import { EvaluationDetails, SubGradeDetail } from '../types';

interface ManualGradeModalProps {
    initialGrade: number;
    initialGradeName: string;
    initialDetails?: EvaluationDetails;
    onSave: (grade: number, gradeName: string, details: EvaluationDetails) => void;
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

export const ManualGradeModal: React.FC<ManualGradeModalProps> = ({ 
    initialGrade, 
    initialGradeName, 
    initialDetails,
    onSave, 
    onClose, 
    isSaving, 
    savingStatus 
}) => {
    const [overallGrade, setOverallGrade] = useState<number | ''>(initialGrade);
    const [gradeName, setGradeName] = useState(initialGradeName);
    const [autoAdjust, setAutoAdjust] = useState(false);
    
    const [details, setDetails] = useState<EvaluationDetails>(initialDetails || {
        centering: { grade: 8, notes: '' },
        corners: { grade: 8, notes: '' },
        edges: { grade: 8, notes: '' },
        surface: { grade: 8, notes: '' },
        printQuality: { grade: 8, notes: '' }
    });

    useEffect(() => {
        if (typeof overallGrade === 'number') {
            const suggestedName = getGradeName(overallGrade);
            setGradeName(suggestedName);
        }
    }, [overallGrade]);

    const handleDetailChange = (category: keyof EvaluationDetails, field: keyof SubGradeDetail, value: any) => {
        setDetails(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                [field]: value
            }
        }));
        // If they manually change a sub-grade, we assume they don't want a generic auto-fill
        setAutoAdjust(false);
    };

    const handleSmartFill = () => {
        // Reset sub-grades to a "pending" state so the AI knows to reinvent them
        // based on the overall score.
        const resetDetails = { ...details };
        Object.keys(resetDetails).forEach(key => {
            (resetDetails as any)[key].notes = "[Regenerate]";
        });
        setDetails(resetDetails);
        setAutoAdjust(true);
    };

    const handleSave = () => {
        if (typeof overallGrade === 'number' && overallGrade >= 1 && overallGrade <= 10 && gradeName.trim()) {
            onSave(overallGrade, gradeName.trim(), details);
        }
    };

    const categories: { key: keyof EvaluationDetails; label: string }[] = [
        { key: 'centering', label: 'Centering' },
        { key: 'corners', label: 'Corners' },
        { key: 'edges', label: 'Edges' },
        { key: 'surface', label: 'Surface' },
        { key: 'printQuality', label: 'Print Quality' }
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-[100] p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6 border-b pb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">Grader Worksheet</h2>
                        <p className="text-xs text-slate-500 font-medium mt-1">AI will rewrite descriptions to justify your scores.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors text-3xl">&times;</button>
                </div>

                <div className="space-y-8">
                    {/* Overall Score Section */}
                    <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 grid grid-cols-1 sm:grid-cols-2 gap-6 relative">
                        <div>
                            <label className="block text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Target Grade</label>
                            <input
                                type="number"
                                value={overallGrade}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '') { setOverallGrade(''); return; }
                                    const num = parseFloat(val);
                                    if (!isNaN(num)) setOverallGrade(Math.max(1, Math.min(10, num)));
                                }}
                                min="1" max="10" step="0.5"
                                className="w-full px-4 py-3 text-3xl font-bold border border-blue-200 rounded-lg shadow-inner focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                disabled={isSaving}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Designation</label>
                            <input
                                type="text"
                                value={gradeName}
                                onChange={(e) => setGradeName(e.target.value)}
                                placeholder="e.g., GEM MT"
                                className="w-full px-4 py-3 text-2xl font-bold border border-blue-200 rounded-lg shadow-inner focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                disabled={isSaving}
                            />
                        </div>
                        <button 
                            onClick={handleSmartFill}
                            className="absolute -bottom-3 right-6 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow-md flex items-center gap-1.5 transition active:scale-95"
                        >
                            <ResyncIcon className="w-3 h-3" />
                            Auto-Adjust Categories to Match
                        </button>
                    </div>

                    {/* technical breakdown section */}
                    <div className="space-y-6 pt-4">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b pb-2 flex justify-between">
                            Technical Breakdown (Scores in 0.5)
                            {autoAdjust && <span className="text-[10px] text-blue-500 animate-pulse lowercase">✨ smart fill active</span>}
                        </h3>
                        
                        {categories.map((cat) => (
                            <div key={cat.key} className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start bg-slate-50 p-4 rounded-xl border border-slate-200 transition hover:border-blue-200">
                                <div className="sm:col-span-3">
                                    <label className="block text-sm font-bold text-slate-700 mb-1">{cat.label}</label>
                                    <input
                                        type="number"
                                        value={details[cat.key].grade}
                                        onChange={(e) => handleDetailChange(cat.key, 'grade', parseFloat(e.target.value) || 0)}
                                        min="0" max="10" step="0.5"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-md font-bold text-blue-600 focus:ring-2 focus:ring-blue-400 focus:outline-none"
                                        disabled={isSaving}
                                    />
                                </div>
                                <div className="sm:col-span-9">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Observations</label>
                                    <textarea
                                        value={details[cat.key].notes === "[Regenerate]" ? "" : details[cat.key].notes}
                                        onChange={(e) => handleDetailChange(cat.key, 'notes', e.target.value)}
                                        placeholder={details[cat.key].notes === "[Regenerate]" ? "AI will auto-generate this description..." : `Notes about ${cat.label.toLowerCase()}...`}
                                        className={`w-full px-3 py-2 border border-slate-300 rounded-md text-sm min-h-[60px] ${details[cat.key].notes === "[Regenerate]" ? 'bg-blue-50 italic' : ''}`}
                                        disabled={isSaving}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-8 mt-6 border-t">
                    <button onClick={onClose} className="py-3 px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition" disabled={isSaving}>
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={typeof overallGrade !== 'number' || !gradeName.trim() || isSaving}
                        className="py-3 px-8 flex justify-center items-center bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-lg disabled:opacity-50 disabled:cursor-wait"
                    >
                        {isSaving ? (
                            <>
                                <SpinnerIcon className="w-5 h-5 mr-2" />
                                <span>{savingStatus || 'Re-analyzing...'}</span>
                            </>
                        ) : (
                            'Apply Changes & Re-analyze'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
