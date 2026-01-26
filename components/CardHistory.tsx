import React, { useState, useEffect } from 'react';
import { CardData } from '../types';
import { ExportIcon, BackIcon, TrashIcon, GoogleSheetIcon, ResyncIcon, SpinnerIcon, CheckIcon, CogIcon } from './icons';
import { CardDetailModal } from './CardDetailModal';
import { SyncSheetModal } from './SyncSheetModal';
import { RewriteAnalysisModal } from './RewriteAnalysisModal';
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
  onGetMarketValue: (card: CardData) => void; 
}

type ResyncState = 'idle' | 'syncing' | 'success';

const CardRow: React.FC<{ card: CardData; onSelect: () => void; onDelete: () => void; onResync?: () => Promise<void>; }> = ({ card, onSelect, onDelete, onResync }) => {
  const [resyncState, setResyncState] = useState<ResyncState>('idle');

  const handleResync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onResync || resyncState !== 'idle') return;

    setResyncState('syncing');
    try {
      await onResync();
      setResyncState('success');
    } catch (error) {
      console.error("Resync failed", error);
      setResyncState('idle'); 
    } finally {
      setTimeout(() => {
        setResyncState('idle');
      }, 2000);
    }
  };

  const getStatusIndicator = () => {
    switch (card.status) {
        case 'grading':
            return <div className="flex items-center gap-2 text-blue-600"><SpinnerIcon className="w-5 h-5" /> <span className="text-sm font-semibold">Grading...</span></div>;
        case 'challenging':
            return <div className="flex items-center gap-2 text-yellow-600"><SpinnerIcon className="w-5 h-5" /> <span className="text-sm font-semibold">Challenging...</span></div>;
        case 'regenerating_summary':
            return <div className="flex items-center gap-2 text-purple-600"><SpinnerIcon className="w-5 h-5" /> <span className="text-sm font-semibold">Rewriting...</span></div>;
        case 'generating_summary':
             return <div className="flex items-center gap-2 text-blue-600"><SpinnerIcon className="w-5 h-5" /> <span className="text-sm font-semibold">Writing Report...</span></div>;
        case 'fetching_value':
            return <div className="flex items-center gap-2 text-green-600"><SpinnerIcon className="w-5 h-5" /> <span className="text-sm font-semibold">Finding Value...</span></div>;
        case 'grading_failed':
            return <div className="text-sm font-semibold text-red-600">Failed</div>;
        case 'needs_review':
            return <div className="text-sm font-bold text-green-600">Review Grade</div>;
        default:
            return <p className="text-sm font-semibold text-slate-600">{card.gradeName || 'Not Graded'}</p>;
    }
  };

  const isProcessing = ['grading', 'challenging', 'regenerating_summary', 'generating_summary', 'fetching_value'].includes(card.status);

  const formatGrade = (grade?: number) => {
      if (grade === undefined) return '-';
      return Number.isInteger(grade) ? grade.toString() : grade.toFixed(1);
  };

  return (
    <div 
      key={card.id} 
      className={`bg-white p-4 rounded-lg flex items-center gap-4 shadow-lg transition-all duration-300 ${isProcessing ? 'opacity-70' : 'cursor-pointer hover:shadow-xl hover:scale-[1.01]'}`}
      onClick={!isProcessing || card.status === 'grading_failed' ? onSelect : undefined}
    >
      <img src={ensureDataUrl(card.frontImage)} alt="Card front" className="w-16 h-22 object-contain rounded-md bg-slate-100"/>
      <div className="flex-grow">
        {card.name ? (
            <>
                <p className="font-bold text-lg">{card.name}</p>
                <p className="text-sm text-slate-600">{card.year} {card.set} #{card.cardNumber}</p>
            </>
        ) : (
            <p className="font-bold text-lg text-slate-500">
                {card.status === 'grading_failed' ? 'Grading Failed' : 'Card Identification in Progress...'}
            </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right w-28">
          <p className="text-xs text-slate-500">GRADE</p>
          <p className="font-bold text-3xl text-blue-600">
            {formatGrade(card.overallGrade)}
          </p>
          {getStatusIndicator()}
        </div>
        {onResync && (
            <button
                onClick={handleResync}
                className="p-2 w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-full transition-colors"
                aria-label="Resync card"
                title="Resync card to sheet"
                disabled={resyncState !== 'idle'}
            >
                {resyncState === 'idle' && <ResyncIcon className="w-5 h-5 hover:text-blue-500" />}
                {resyncState === 'syncing' && <SpinnerIcon className="w-5 h-5 text-blue-500" />}
                {resyncState === 'success' && <CheckIcon className="w-5 h-5 text-green-600" />}
            </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm('Are you sure you want to remove this card from your collection? This action cannot be undone.')) {
              onDelete();
            }
          }}
          className="p-2 text-slate-500 hover:text-red-500 hover:bg-slate-100 rounded-full transition-colors"
          aria-label="Remove card"
          title="Remove card"
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export const CardHistory: React.FC<CardHistoryProps> = ({ 
    cards, onBack, onDelete, getAccessToken, onCardsSynced, onChallengeGrade, onResync, onRetryGrading,
    onRewriteAllAnalyses, resetRewriteState, isRewriting, rewriteProgress, rewrittenCount, 
    rewriteFailCount, rewriteStatusMessage, onAcceptGrade, onManualGrade, onLoadCollection, onGetMarketValue
}) => {
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [isSheetModalOpen, setIsSheetModalOpen] = useState(false);
  const [isRewriteModalOpen, setIsRewriteModalOpen] = useState(false);
  const [isSheetSettingsOpen, setIsSheetSettingsOpen] = useState(false);
  const [hasSheetConfig, setHasSheetConfig] = useState(!!localStorage.getItem('google_sheet_url'));
  const [customSyncList, setCustomSyncList] = useState<CardData[] | null>(null);

  useEffect(() => {
    if (selectedCard) {
      const updatedCard = cards.find(c => c.id === selectedCard.id);
      if (updatedCard) {
        setSelectedCard(updatedCard);
      } else {
        setSelectedCard(null);
      }
    }
  }, [cards, selectedCard]);

  useEffect(() => {
    setHasSheetConfig(!!localStorage.getItem('google_sheet_url'));
  }, [isSheetSettingsOpen]);

  const handleCloseRewriteModal = () => {
    setIsRewriteModalOpen(false);
    resetRewriteState();
  }
  
  const needsReviewCards = cards.filter(c => c.status === 'needs_review' || c.status === 'grading_failed').sort((a,b) => b.timestamp - a.timestamp);
  const processingQueueCards = cards.filter(c => ['grading', 'challenging', 'regenerating_summary', 'generating_summary', 'fetching_value'].includes(c.status)).sort((a,b) => b.timestamp - a.timestamp);
  const collectionCards = cards.filter(c => c.status === 'reviewed');
  const cardsToSync = collectionCards.filter(card => !card.isSynced).sort((a,b) => b.timestamp - a.timestamp);
  const syncedCards = collectionCards.filter(card => card.isSynced).sort((a,b) => b.timestamp - a.timestamp);

  const exportToCsv = () => {
    const cardsToExport = cards.filter(c => c.status === 'reviewed' || c.status === 'needs_review');
    if (cardsToExport.length === 0) return;
    const headers = [
        'ID', 'Year', 'Company', 'Set', 'Name', 'Edition', 'Card Number', 'Grade Name', 'Overall Grade',
        'Centering Grade', 'Centering Notes', 'Corners Grade', 'Corners Notes', 'Edges Grade', 'Edges Notes', 
        'Surface Grade', 'Surface Notes', 'Print Quality Grade', 'Print Quality Notes', 'Summary', 'Estimated Value'
    ];
    
    const rows = cardsToExport.map(card => {
      const d = card.details;
      const subgradeCols = [
        d?.centering?.grade, `"${d?.centering?.notes || ''}"`,
        d?.corners?.grade, `"${d?.corners?.notes || ''}"`,
        d?.edges?.grade, `"${d?.edges?.notes || ''}"`,
        d?.surface?.grade, `"${d?.surface?.notes || ''}"`,
        d?.printQuality?.grade, `"${d?.printQuality?.notes || ''}"`,
      ];

      return [
        card.id, card.year, card.company, card.company === card.set ? '' : card.set,
        card.name, card.edition, `"#${card.cardNumber}"`, card.gradeName, card.overallGrade, 
        ...subgradeCols,
        `"${card.summary || ''}"`,
        card.marketValue ? `${card.marketValue.currency} ${card.marketValue.averagePrice}` : 'N/A'
      ].join(',');
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "card_collection.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleResyncAll = () => {
    if (collectionCards.length === 0) return;
    setCustomSyncList(collectionCards);
    setIsSheetModalOpen(true);
  };
  
  return (
    <>
      <div className="w-full max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <button onClick={onBack} className="flex items-center gap-2 text-blue-600 hover:text-blue-500 transition">
              <BackIcon className="w-5 h-5" />
              Back to Scanner
          </button>
          <h1 className="text-2xl md:text-3xl font-bold text-center order-first w-full sm:order-none sm:w-auto">My Collection</h1>
          <div className="flex gap-2">
            <button
                onClick={() => setIsRewriteModalOpen(true)}
                disabled={collectionCards.length === 0 || isRewriting}
                className="flex items-center gap-2 py-2 px-4 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Rewrite AI analysis for all cards"
            >
                <ResyncIcon className={`h-5 w-5 ${isRewriting ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Rewrite Analyses</span>
            </button>
            <button
                onClick={exportToCsv}
                disabled={cards.length === 0}
                className="flex items-center gap-2 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <ExportIcon className="h-5 w-5" />
                <span className="hidden sm:inline">CSV</span>
            </button>
          </div>
        </div>

        {/* Global Toolbar for Sheet Sync and Settings - Always visible if cards exist */}
        <div className="bg-white p-4 rounded-xl shadow-md border border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
                <div className="bg-green-100 p-2 rounded-lg">
                    <GoogleSheetIcon className="w-6 h-6" />
                </div>
                <div>
                    <p className="text-sm font-bold text-slate-800">Google Sheets Sync</p>
                    <p className="text-xs text-slate-500">
                        {hasSheetConfig ? "Sheet configured and ready" : "Setup required to sync data"}
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                <button
                    onClick={() => setIsSheetSettingsOpen(true)}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition"
                >
                    <CogIcon className="w-5 h-5" />
                    <span>Settings</span>
                </button>
                <button
                    onClick={handleResyncAll}
                    disabled={collectionCards.length === 0}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition disabled:opacity-50"
                    title="Sync entire collection (all cards)"
                >
                    <ResyncIcon className="w-5 h-5" />
                    <span>Resync All</span>
                </button>
                <button
                    onClick={() => setIsSheetModalOpen(true)}
                    disabled={cardsToSync.length === 0}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 py-2 px-6 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition disabled:opacity-50"
                >
                    <CheckIcon className="w-5 h-5" />
                    <span>Sync Unsynced ({cardsToSync.length})</span>
                </button>
            </div>
        </div>

        {cards.length === 0 ? (
             <div className="py-12 bg-slate-100/50 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-4 text-center">
                <p className="text-lg font-medium text-slate-600">No cards loaded yet.</p>
                {onLoadCollection && (
                    <button 
                        onClick={onLoadCollection}
                        className="flex items-center gap-2 py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white text-lg font-bold rounded-full shadow-lg transition-transform transform hover:scale-105"
                    >
                        <ResyncIcon className="w-6 h-6" />
                        Load Collection from Google Drive
                    </button>
                )}
             </div>
        ) : (
            <>
                {needsReviewCards.length > 0 && (
                    <div className="p-4 bg-green-50/50 rounded-lg space-y-4">
                        <h2 className="text-xl font-bold text-green-800">Newly Graded for Review ({needsReviewCards.length})</h2>
                        {needsReviewCards.map(card => (
                            <CardRow key={card.id} card={card} onSelect={() => setSelectedCard(card)} onDelete={() => onDelete(card.id)} />
                        ))}
                    </div>
                )}
                
                {processingQueueCards.length > 0 && (
                    <div className="p-4 bg-blue-50/50 rounded-lg space-y-4">
                        <h2 className="text-xl font-bold text-blue-800">Processing Queue ({processingQueueCards.length})</h2>
                        {processingQueueCards.map(card => (
                            <CardRow key={card.id} card={card} onSelect={() => {}} onDelete={() => onDelete(card.id)} />
                        ))}
                    </div>
                )}

                <div className="p-4 bg-slate-100/50 rounded-lg space-y-4">
                    <h2 className="text-xl font-bold text-slate-800">Collection ({collectionCards.length})</h2>
                    
                    <div className="p-4 bg-white rounded-lg space-y-4">
                        <h3 className="text-lg font-bold text-slate-700">Not yet synced ({cardsToSync.length})</h3>
                        {cardsToSync.length === 0 ? (
                            <p className="text-slate-500 text-sm italic py-2 text-center">All cards in your collection are synced.</p>
                        ) : (
                            cardsToSync.map(card => (
                                <CardRow key={card.id} card={card} onSelect={() => setSelectedCard(card)} onDelete={() => onDelete(card.id)} />
                            ))
                        )}
                    </div>
                    
                    <div className="p-4 bg-white rounded-lg space-y-4">
                        <h3 className="text-lg font-bold text-slate-700">Already synced ({syncedCards.length})</h3>
                         {syncedCards.length === 0 ? (
                            <p className="text-slate-500 text-sm italic py-2 text-center">No cards have been synced yet.</p>
                        ) : (
                            syncedCards.map(card => (
                                <CardRow 
                                    key={card.id} 
                                    card={card} 
                                    onSelect={() => setSelectedCard(card)} 
                                    onDelete={() => onDelete(card.id)}
                                    onResync={() => onResync(card)}
                                />
                            ))
                        )}
                    </div>
                </div>
            </>
        )}
      </div>
      {selectedCard && (
        <CardDetailModal 
          card={selectedCard} 
          onClose={() => setSelectedCard(null)}
          onChallengeGrade={onChallengeGrade}
          onAcceptGrade={onAcceptGrade}
          onDelete={onDelete}
          onManualGrade={onManualGrade}
          onRetryGrading={onRetryGrading}
          onGetMarketValue={onGetMarketValue} 
        />
      )}
      {isSheetModalOpen && (
        <SyncSheetModal 
          cardsToSync={customSyncList || cardsToSync}
          onClose={() => { setIsSheetModalOpen(false); setCustomSyncList(null); }}
          getAccessToken={getAccessToken}
          onSyncSuccess={onCardsSynced}
        />
      )}
      {isRewriteModalOpen && (
        <RewriteAnalysisModal
            totalCards={collectionCards.length}
            onClose={handleCloseRewriteModal}
            onRewrite={onRewriteAllAnalyses}
            isRewriting={isRewriting}
            rewriteProgress={rewriteProgress}
            rewrittenCount={rewrittenCount}
            rewriteFailCount={rewriteFailCount}
            rewriteStatusMessage={rewriteStatusMessage}
        />
      )}
      {isSheetSettingsOpen && (
        <SheetSettingsModal
            onClose={() => setIsSheetSettingsOpen(false)}
        />
      )}
    </>
  );
};