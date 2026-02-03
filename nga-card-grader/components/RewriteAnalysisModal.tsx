import React, { useState, useEffect } from 'react';
import { SpinnerIcon, CheckIcon } from './icons';

interface RewriteAnalysisModalProps {
    totalCards: number;
    onClose: () => void;
    onRewrite: () => Promise<void>;
    isRewriting: boolean;
    rewriteProgress: number;
    rewrittenCount: number;
    rewriteFailCount: number;
    rewriteStatusMessage: string;
}

export const RewriteAnalysisModal: React.FC<RewriteAnalysisModalProps> = ({
    totalCards,
    onClose,
    onRewrite,
    isRewriting,
    rewriteProgress,
    rewrittenCount,
    rewriteFailCount,
    rewriteStatusMessage
}) => {
    // This state controls the internal view of the modal
    const [view, setView] = useState<'confirm' | 'progress' | 'complete'>('confirm');

    useEffect(() => {
        if (isRewriting) {
            setView('progress');
        } else {
            // isRewriting is now false. This means the process has stopped.
            if (view === 'progress') {
                if (rewriteProgress === totalCards && totalCards > 0) {
                    // It finished successfully.
                    const timer = setTimeout(() => setView('complete'), 500);
                    return () => clearTimeout(timer);
                } else {
                    // It stopped before finishing. This implies an error or was cancelled.
                    // If progress isn't full, but we got here, it's complete.
                     if (rewriteProgress > 0) {
                        setView('complete');
                     } else {
                        onClose();
                     }
                }
            }
        }
    }, [isRewriting, rewriteProgress, totalCards, view, onClose]);

    const handleConfirmRewrite = () => {
        onRewrite(); // This is async but we don't await it here, the state change will handle the UI
    };
    
    const progressPercentage = totalCards > 0 ? Math.round((rewriteProgress / totalCards) * 100) : 0;

    const renderContent = () => {
        switch (view) {
            case 'progress':
                return (
                    <>
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Rewriting Analyses...</h2>
                        <div className="space-y-4">
                            <p className="text-sm text-slate-600">
                                The AI is re-analyzing your collection. Please keep this window open.
                            </p>
                            <div className="relative pt-1">
                                <div className="flex mb-2 items-center justify-between">
                                    <div>
                                        <span className="text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-blue-600 bg-blue-200">
                                            Card {rewriteProgress} of {totalCards}
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-semibold inline-block text-blue-600">
                                            {progressPercentage}%
                                        </span>
                                    </div>
                                </div>
                                <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-blue-200">
                                    <div style={{ width: `${progressPercentage}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-500 transition-all duration-300"></div>
                                </div>
                            </div>
                            <div className="h-6 text-center text-sm text-slate-500 truncate" title={rewriteStatusMessage}>
                                {rewriteStatusMessage}
                            </div>
                        </div>
                    </>
                );
            case 'complete':
                const skippedCount = totalCards - rewrittenCount - rewriteFailCount;
                return (
                     <>
                        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <CheckIcon className="w-6 h-6 text-green-500" />
                            Rewrite Complete
                        </h2>
                        <p className="text-sm text-slate-600">
                            Process finished. Scanned all {totalCards} {totalCards === 1 ? 'card' : 'cards'}.
                        </p>
                        <div className="mt-3 bg-slate-50 p-3 rounded-md border border-slate-200 space-y-1">
                            <p className="text-sm text-slate-700"><strong className="font-semibold text-green-700">{rewrittenCount}</strong> {rewrittenCount === 1 ? 'analysis was' : 'analyses were'} updated.</p>
                            <p className="text-sm text-slate-700"><strong className="font-semibold text-slate-900">{skippedCount}</strong> {skippedCount === 1 ? 'card was' : 'cards were'} already correct.</p>
                             {rewriteFailCount > 0 && (
                                <p className="text-sm text-red-700"><strong className="font-semibold">{rewriteFailCount}</strong> {rewriteFailCount === 1 ? 'card' : 'cards'} failed to update.</p>
                            )}
                        </div>
                    </>
                );
            case 'confirm':
            default:
                 return (
                     <>
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Rewrite All Analyses?</h2>
                        <div className="space-y-4 text-sm text-slate-600">
                            <p>
                                This will re-analyze all <strong className="font-semibold text-slate-800">{totalCards} cards</strong> in your collection to ensure their written descriptions match their assigned grades.
                            </p>
                            <p className="font-semibold text-yellow-700 bg-yellow-50 p-3 rounded-md">
                                This action does not change the grades themselves. The process cannot be undone and may take several minutes to complete.
                            </p>
                        </div>
                     </>
                 );
        }
    };

    const renderFooter = () => {
        if (view === 'progress') {
            return (
                <button
                    className="py-2 px-4 w-full flex justify-center items-center bg-slate-400 text-white font-semibold rounded-md cursor-wait"
                    disabled
                >
                    <SpinnerIcon className="w-5 h-5 mr-2" />
                    Processing...
                </button>
            );
        }
        if (view === 'complete') {
            return (
                <button
                    onClick={onClose}
                    className="py-2 px-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition"
                >
                    Close
                </button>
            );
        }
        return (
             <div className="flex justify-end gap-3 pt-6">
                <button onClick={onClose} className="py-2 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-md transition">
                    Cancel
                </button>
                <button
                    onClick={handleConfirmRewrite}
                    className="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition"
                >
                    Confirm & Rewrite
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4 animate-fade-in" onClick={view !== 'progress' ? onClose : undefined}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                {renderContent()}
                <div className="pt-6">
                    {renderFooter()}
                </div>
            </div>
        </div>
    );
};