
import React, { useState } from 'react';
import { CardData } from '../types';
import { ExportIcon, BackIcon, TrashIcon, GoogleSheetIcon, ResyncIcon, SpinnerIcon, CheckIcon, CogIcon } from './icons';
import { CardDetailModal } from './CardDetailModal';
import { SyncSheetModal } from './SyncSheetModal';
import { SheetSettingsModal } from './SheetSettingsModal';
import { ensureDataUrl } from '../utils/fileUtils';

interface CardHistoryProps {
  cards: CardData[];
  onBack: () => void;
  onDelete: (cardId: string) => void;
  getAccessToken: () => Promise<string>;
  onCardsSynced: (syncedCards: CardData[]) => void;
  onChallengeGrade: (card: CardData, direction: 'higher' | 'lower') => void;
  onResync: (card: CardData) => Promise<void>;
  onRetryGrading: (card: CardData) => void; 
  onRewriteAllAnalyses: () => Promise<void>;
  resetRewriteState: () => void;
  isRewriting: boolean;
  rewriteProgress: number;
  rewrittenCount: number;
  rewriteFailCount: number;
  rewriteStatusMessage: string;
  onAcceptGrade: (cardId: string) => void;
  onManualGrade: (card: CardData, grade: number, gradeName: string) => void;
  onLoadCollection?: () => void;
  onSyncFromSheet?: () => Promise<void>;
  onGetMarketValue: (card: CardData) => void; 
  userName: string;
}

const CardRow: React.FC<{ card: CardData; onSelect: () => void; onDelete: () => void; }> = ({ card, onSelect, onDelete }) => {
  const isBlocking = ['grading', 'challenging', 'regenerating_summary'].includes(card.status);
  
  const getStatusIndicator = () => {
    switch (card.status) {
        case 'grading': return <div className="text-sm font-semibold text-blue-600">Grading...</div>;
        case 'challenging': return <div className="text-sm font-semibold text-yellow-600">Challenging...</div>;
        case 'needs_review': return <div className="text-sm font-bold text-green-600">Review Now</div>;
        case 'grading_failed': return <div className="text-sm font-semibold text-red-600">Failed</div>;
        case 'fetching_value': return <div className="text-sm font-semibold text-green-600 animate-pulse">Pricing...</div>;
        default: return <p className="text-sm font-semibold text-slate-600">{card.gradeName || 'Grades'}</p>;
    }
  };

  return (
    <div 
      className={`bg-white p-4 rounded-lg flex items-center gap-4 shadow-lg transition-all duration-300 ${isBlocking ? 'opacity-70 pointer-events-none' : 'cursor-pointer hover:shadow-xl hover:scale-[1.01]'}`}
      onClick={onSelect}
    >
      <img src={ensureDataUrl(card.frontImage)} alt="Card" className="w-16 h-22 object-contain rounded-md bg-slate-100"/>
      <div className="flex-grow">
        <p className="font-bold text-lg">{card.name || 'Identifying...'}</p>
        <p className="text-sm text-slate-600">{card.year} {card.set} #{card.cardNumber}</p>
      </div>
      <div className="text-right w-24">
        <p className="text-xs text-slate-500">GRADE</p>
        <p className="font-bold text-3xl text-blue-600">{(card.overallGrade || 0).toFixed(1)}</p>
        {getStatusIndicator()}
      </div>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-2 text-slate-400 hover:text-red-500 transition">
        <TrashIcon className="w-5 h-5" />
      </button>
    </div>
  );
};

export const CardHistory: React.FC<CardHistoryProps> = (props) => {
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [isSheetSettingsOpen, setIsSheetSettingsOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [customSyncList, setCustomSyncList] = useState<CardData[] | null>(null);
  const [isPullingFromSheet, setIsPullingFromSheet] = useState(false);

  const collectionCards = props.cards.filter(c => ['reviewed', 'fetching_value'].includes(c.status));
  const unsyncedCards = collectionCards.filter(c => !c.isSynced);
  const needsReviewCards = props.cards.filter(c => ['needs_review', 'grading_failed', 'grading', 'challenging'].includes(c.status));

  const handleResyncAll = () => {
    if (collectionCards.length === 0) {
        alert("No graded cards in collection to sync.");
        return;
    }
    setCustomSyncList(collectionCards);
    setIsSyncModalOpen(true);
  };

  const handleSyncFromSheet = async () => {
    if (!props.onSyncFromSheet) return;
    if (!window.confirm("This will pull all records from your Google Sheet. It may take a moment. Continue?")) return;
    
    setIsPullingFromSheet(true);
    try {
        await props.onSyncFromSheet();
    } catch (err) {
        alert("Failed to sync from sheet. Please check your URL in settings.");
    } finally {
        setIsPullingFromSheet(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 md:p-6 space-y-6 animate-fade-in">
        <div className="flex justify-between items-center">
            <button onClick={props.onBack} className="flex items-center gap-2 text-blue-600 font-bold hover:text-blue-500 transition">
                <BackIcon className="w-5 h-5" /> Back
            </button>
            <h1 className="text-2xl font-bold">My Collection</h1>
            <button onClick={() => setIsSheetSettingsOpen(true)} className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition">
                <CogIcon className="w-5 h-5" />
            </button>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-md border border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
                <div className="bg-green-100 p-2 rounded-lg"><GoogleSheetIcon className="w-6 h-6" /></div>
                <div>
                    <p className="text-sm font-bold">Google Sheets Sync</p>
                    <p className="text-xs text-slate-500">{unsyncedCards.length} pending</p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
                <button 
                  onClick={handleSyncFromSheet}
                  disabled={isPullingFromSheet}
                  className="flex items-center gap-2 py-2 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg transition disabled:opacity-50"
                >
                    {isPullingFromSheet ? <SpinnerIcon className="w-5 h-5" /> : <ResyncIcon className="w-5 h-5" />}
                    <span className="hidden sm:inline">{isPullingFromSheet ? 'Pulling...' : 'Sync From Sheet'}</span>
                </button>
                <button 
                  onClick={handleResyncAll} 
                  disabled={collectionCards.length === 0}
                  className="flex items-center gap-2 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition disabled:opacity-50"
                >
                    <ResyncIcon className="w-5 h-5" />
                    <span className="hidden sm:inline">Resync All To Sheet</span>
                </button>
                <button 
                  onClick={() => { setCustomSyncList(null); setIsSyncModalOpen(true); }} 
                  disabled={unsyncedCards.length === 0} 
                  className="flex items-center gap-2 py-2 px-6 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition disabled:opacity-50"
                >
                    <CheckIcon className="w-5 h-5" />
                    <span>Sync New</span>
                </button>
            </div>
        </div>

        <div className="space-y-8">
            {needsReviewCards.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-bold text-blue-700">In Progress / Pending</h2>
                    {needsReviewCards.map(c => (
                        <CardRow key={c.id} card={c} onSelect={() => setSelectedCard(c)} onDelete={() => props.onDelete(c.id)} />
                    ))}
                </div>
            )}

            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-800">Collection ({collectionCards.length})</h2>
                    {props.onLoadCollection && (
                        <button onClick={props.onLoadCollection} className="text-xs font-bold text-blue-600 hover:underline">
                            Refresh from Drive
                        </button>
                    )}
                </div>
                {props.cards.length === 0 ? (
                    <div className="py-20 text-center text-slate-400 border-2 border-dashed rounded-xl bg-slate-50">
                        <p className="mb-4">No cards found in local cache.</p>
                        <div className="flex gap-4 justify-center">
                            <button onClick={props.onLoadCollection} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold shadow-lg">Load from Drive</button>
                            <button onClick={handleSyncFromSheet} className="bg-green-600 text-white px-6 py-2 rounded-full font-bold shadow-lg">Load from Sheet</button>
                        </div>
                    </div>
                ) : (
                    collectionCards.map(c => (
                        <CardRow key={c.id} card={c} onSelect={() => setSelectedCard(c)} onDelete={() => props.onDelete(c.id)} />
                    ))
                )}
            </div>
        </div>

        {selectedCard && (
            <CardDetailModal 
                card={selectedCard} 
                onClose={() => setSelectedCard(null)} 
                onChallengeGrade={props.onChallengeGrade} 
                onAcceptGrade={props.onAcceptGrade}
                onDelete={props.onDelete}
                onManualGrade={props.onManualGrade}
                onRetryGrading={props.onRetryGrading}
                onGetMarketValue={props.onGetMarketValue}
            />
        )}

        {isSheetSettingsOpen && <SheetSettingsModal onClose={() => setIsSheetSettingsOpen(false)} />}

        {isSyncModalOpen && (
            <SyncSheetModal 
                cardsToSync={customSyncList || unsyncedCards}
                onClose={() => { setIsSyncModalOpen(false); setCustomSyncList(null); }}
                getAccessToken={props.getAccessToken}
                onSyncSuccess={props.onCardsSynced}
                userName={props.userName}
            />
        )}
    </div>
  );
};
