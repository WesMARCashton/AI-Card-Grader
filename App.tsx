
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CardData, AppView, User } from './types';
import { CardScanner } from './components/CardScanner';
import { CardHistory } from './components/CardHistory';
import { Auth } from './components/Auth';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import { 
  challengeGrade, 
  regenerateCardAnalysisForGrade,
  identifyCard,
  gradeCardPreliminary,
  generateCardSummary,
  getCardMarketValue
} from './services/geminiService';
import { getCollection, saveCollection } from './services/driveService';
import { syncToSheet } from './services/sheetsService';
import { HistoryIcon } from './components/icons';
import { dataUrlToBase64 } from './utils/fileUtils';
import { SyncSheetModal } from './components/SyncSheetModal';

const BACKUP_KEY = 'nga_card_backup';

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

const App: React.FC = () => {
  const { user, signOut, getAccessToken, isAuthReady } = useGoogleAuth();
  
  const [view, setView] = useState<AppView>('scanner');
  const [cards, setCards] = useState<CardData[]>([]);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingStatus, setGradingStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteProgress, setRewriteProgress] = useState(0);
  const [rewrittenCount, setRewrittenCount] = useState(0);
  const [rewriteFailCount, setRewriteFailCount] = useState(0);
  const [rewriteStatusMessage, setRewriteStatusMessage] = useState('');
  
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [cardsToResyncManually, setCardsToResyncManually] = useState<CardData[]>([]);

  const processingCards = useRef(new Set<string>());
  const CONCURRENCY_LIMIT = 2;

  useEffect(() => {
    if (cards.length > 0) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(cards));
      } catch (e) {
        console.warn("Local backup failed due to storage quota:", e);
      }
    }
  }, [cards]);

  useEffect(() => {
    if (user) {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (backup) {
        try {
          const savedCards: CardData[] = JSON.parse(backup);
          if (savedCards.length > 0) {
            const recoveredCards = savedCards.map(c => {
              if (['grading', 'challenging', 'regenerating_summary', 'generating_summary', 'fetching_value'].includes(c.status)) {
                return { 
                  ...c, 
                  status: 'grading_failed' as const, 
                  errorMessage: 'Recovered from session crash. Please retry.' 
                };
              }
              return c;
            });
            setCards(current => current.length === 0 ? recoveredCards : current);
          }
        } catch (e) {
          console.error("Failed to parse local backup", e);
        }
      }
    } else {
      setCards([]);
      setDriveFileId(null);
      setSyncStatus('idle');
      setError(null);
      setIsRewriting(false);
      setView('scanner');
    }
  }, [user]);

  const handleSyncWithDrive = useCallback(async (silent: boolean = false) => {
    if (!user || !getAccessToken) return;
    setSyncStatus('loading');
    setError(null);
    try {
      const token = await getAccessToken(silent);
      const { fileId, cards: loadedCards } = await getCollection(token);
      
      const safeString = (val: any): string | undefined => {
          if (val === null || val === undefined) return undefined;
          return String(val);
      };

      const validCards: CardData[] = (loadedCards || []).map((card: any) => ({
          ...card,
          id: safeString(card.id) || generateId(),
          status: (safeString(card.status) || 'reviewed') as CardData['status'],
          timestamp: typeof card.timestamp === 'number' ? card.timestamp : Date.now(),
      }));

      setCards(validCards);
      setDriveFileId(fileId);
      setSyncStatus('success');
      if (!silent) {
          setTimeout(() => {
            alert(`Sync Complete! Found ${validCards.length} cards.`);
            setView('history');
          }, 100);
      }
    } catch (err: any) {
      if (err.message !== 'interaction_required') {
          setError(err?.message || 'Sync failed.');
          setSyncStatus('error');
      }
    }
  }, [user, getAccessToken]);

  const saveCollectionToDrive = useCallback(async (cardsToSave: CardData[]) => {
    if (!user || !getAccessToken) return;
    try {
      const token = await getAccessToken(true); 
      const newFileId = await saveCollection(token, driveFileId, cardsToSave);
      if (newFileId !== driveFileId) setDriveFileId(newFileId);
    } catch (err: any) {
      if (err.message !== 'interaction_required') console.error("Save error", err);
    }
  }, [user, getAccessToken, driveFileId]);
  
  // Fix: Strictly rely on aistudio.openSelectKey() and remove manual API key UI.
  const handleOpenApiKeyDialog = async () => {
    if (window.aistudio) {
      try {
        await window.aistudio.openSelectKey();
      } catch (e) {
        console.error("Failed to open AI Studio key dialog", e);
      }
    }
  };

  const checkHasApiKey = async () => {
    if (window.aistudio) return await window.aistudio.hasSelectedApiKey();
    return true; // Assume standard process.env.API_KEY is present otherwise
  };

  const processCardInBackground = useCallback(async (cardToProcess: CardData) => {
    if (processingCards.current.has(cardToProcess.id)) return;
    processingCards.current.add(cardToProcess.id);
  
    try {
      // Fix: Check for key selection exclusively via aistudio.
      const hasKey = await checkHasApiKey();
      if (!hasKey) {
        setError("Please select an API key to continue grading.");
        processingCards.current.delete(cardToProcess.id);
        await handleOpenApiKeyDialog();
        setCards(current => current.map(c => c.id === cardToProcess.id ? { ...c, status: 'grading_failed' as const, errorMessage: "API Key Required" } : c));
        return;
      }

      let finalCardData: Partial<CardData> = {};
      let finalStatus: CardData['status'] = 'needs_review';
      const frontImageBase64 = dataUrlToBase64(cardToProcess.frontImage);
      const backImageBase64 = dataUrlToBase64(cardToProcess.backImage);

      switch (cardToProcess.status) {
        case 'grading':
          const [idInfo, gradeInfo] = await Promise.all([
            identifyCard(frontImageBase64, backImageBase64),
            gradeCardPreliminary(frontImageBase64, backImageBase64)
          ]);
          finalCardData = { ...idInfo, ...gradeInfo };
          break;
        case 'generating_summary':
          finalCardData = { summary: await generateCardSummary(frontImageBase64, backImageBase64, cardToProcess) };
          finalStatus = 'fetching_value' as const;
          break;
        case 'challenging':
          finalCardData = { ...await challengeGrade(cardToProcess, cardToProcess.challengeDirection!, () => {}), challengeDirection: undefined };
          finalStatus = 'needs_review' as const;
          break;
        case 'regenerating_summary':
          finalCardData = await regenerateCardAnalysisForGrade(
            frontImageBase64, backImageBase64,
            { name: cardToProcess.name!, team: cardToProcess.team!, set: cardToProcess.set!, edition: cardToProcess.edition!, cardNumber: cardToProcess.cardNumber!, company: cardToProcess.company!, year: cardToProcess.year! },
            cardToProcess.overallGrade!, cardToProcess.gradeName!, () => {}
          );
          finalStatus = 'fetching_value' as const;
          break;
        case 'fetching_value':
            finalCardData = { marketValue: await getCardMarketValue(cardToProcess) };
            finalStatus = 'reviewed' as const;
            break;
        default:
          processingCards.current.delete(cardToProcess.id);
          return;
      }
      
      setCards(current => {
        const updated = current.map(c => c.id === cardToProcess.id ? { ...c, ...finalCardData, status: finalStatus, isSynced: false } : c);
        saveCollectionToDrive(updated);
        return updated;
      });
    } catch (err: any) {
      // Fix: Handle API_KEY_RESET_REQUIRED as per guidelines.
      if (err.message === 'API_KEY_RESET_REQUIRED') {
         setError("API access failed. Please re-select your paid project API key.");
         await handleOpenApiKeyDialog();
      } else if (err.message === 'API_KEY_MISSING') {
         setError("Invalid or Missing API Key. Please re-select your project key.");
         await handleOpenApiKeyDialog();
      }
      setCards(current => {
        const updated = current.map(card => card.id === cardToProcess.id ? { ...card, status: 'grading_failed' as const, errorMessage: err.message } : card);
        saveCollectionToDrive(updated);
        return updated;
      });
    } finally {
      processingCards.current.delete(cardToProcess.id);
    }
  }, [saveCollectionToDrive]);

  useEffect(() => {
    const queue = cards.filter(c => ['grading', 'challenging', 'regenerating_summary', 'generating_summary', 'fetching_value'].includes(c.status) && !processingCards.current.has(c.id));
    const available = CONCURRENCY_LIMIT - processingCards.current.size;
    if (queue.length > 0 && available > 0) queue.slice(0, available).forEach(c => processCardInBackground(c));
  }, [cards, processCardInBackground]);

  const handleRatingRequest = useCallback(async (f: string, b: string) => {
    const hasKey = await checkHasApiKey();
    if (!hasKey) {
      await handleOpenApiKeyDialog();
    }

    const newCard: CardData = { id: generateId(), frontImage: f, backImage: b, timestamp: Date.now(), gradingSystem: 'NGA', isSynced: false, status: 'grading' };
    setCards(current => {
        const updated = [newCard, ...current];
        saveCollectionToDrive(updated);
        return updated;
    });
  }, [saveCollectionToDrive]);

  const handleAcceptGrade = useCallback(async (id: string) => {
      setCards(current => {
          const updated = current.map(c => c.id === id ? { ...c, status: 'generating_summary' as const } : c);
          saveCollectionToDrive(updated);
          return updated;
      });
  }, [saveCollectionToDrive]);

  const handleCardsSynced = (syncedCards: CardData[]) => {
    const syncedIds = new Set(syncedCards.map(c => c.id));
    setCards(current => {
        const updated = current.map(card => syncedIds.has(card.id) ? { ...card, isSynced: true } : card);
        saveCollectionToDrive(updated);
        return updated;
    });
  };

  const handleResyncCard = useCallback(async (card: CardData) => {
      const sheetUrl = localStorage.getItem('google_sheet_url');
      if (!sheetUrl) {
          setCardsToResyncManually([card]);
          setIsSyncModalOpen(true);
          return;
      }
      try {
          const token = await getAccessToken(false);
          await syncToSheet(token, sheetUrl, [card]);
          handleCardsSynced([card]);
      } catch (err: any) {
          setError(err.message || 'Resync failed.');
      }
  }, [getAccessToken]);

  const renderView = () => {
    switch (view) {
      case 'history':
        return <CardHistory 
                  cards={cards} 
                  onBack={() => setView('scanner')} 
                  onDelete={id => setCards(cur => { const upd = cur.filter(c => c.id !== id); saveCollectionToDrive(upd); return upd; })} 
                  getAccessToken={() => getAccessToken(false)} 
                  onCardsSynced={handleCardsSynced}
                  onChallengeGrade={(c, d) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'challenging', challengeDirection: d } : x))}
                  onResync={handleResyncCard}
                  onRetryGrading={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'grading', errorMessage: undefined } : x))}
                  onRewriteAllAnalyses={async () => {}}
                  resetRewriteState={() => {}}
                  isRewriting={isRewriting} rewriteProgress={rewriteProgress} rewrittenCount={rewrittenCount} rewriteFailCount={rewriteFailCount} rewriteStatusMessage={rewriteStatusMessage}
                  onAcceptGrade={handleAcceptGrade}
                  onManualGrade={(c, g, n) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'regenerating_summary', overallGrade: g, gradeName: n } : x))}
                  onLoadCollection={() => handleSyncWithDrive(false)} 
                  onGetMarketValue={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'fetching_value' } : x))}
                />;
      default:
        return <CardScanner 
                  onRatingRequest={handleRatingRequest} 
                  isGrading={isGrading} 
                  gradingStatus={gradingStatus} 
                  isLoggedIn={!!user}
                  hasCards={cards.length > 0}
                  onSyncDrive={() => handleSyncWithDrive(false)}
                  isSyncing={syncStatus === 'loading'}
               />;
    }
  };

  return (
    <div className="min-h-screen font-sans flex flex-col items-center p-4">
        <header className="w-full max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center p-4 gap-4">
            <img src="https://mcusercontent.com/d7331d7f90c4b088699bd7282/images/98cb8f09-7621-798a-803a-26d394c7b10f.png" alt="MARC AI Grader Logo" className="h-10 w-auto" />
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {user && (
                  <>
                    <button onClick={() => setView(view === 'history' ? 'scanner' : 'history')} className="relative flex items-center gap-2 py-2 px-4 bg-white/70 hover:bg-white text-slate-800 font-semibold rounded-lg shadow-md transition border border-slate-300">
                      <HistoryIcon className="h-5 w-5" />
                      <span className="hidden sm:inline">{view === 'history' ? 'Scanner' : `Collection (${cards.length})`}</span>
                    </button>
                  </>
                )}
                <Auth user={user} onSignOut={signOut} isAuthReady={isAuthReady} />
              </div>
            </div>
        </header>
        <main className="w-full flex-grow flex flex-col justify-center items-center">
            {error && (
              <div className="w-full max-w-md bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4 flex justify-between items-center">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-red-900 font-bold ml-4">×</button>
              </div>
            )}
            {renderView()}
            {isSyncModalOpen && (
              <SyncSheetModal 
                cardsToSync={cardsToResyncManually}
                onClose={() => { setIsSyncModalOpen(false); setCardsToResyncManually([]); }}
                getAccessToken={() => getAccessToken(false)}
                onSyncSuccess={handleCardsSynced}
              />
            )}
        </main>
    </div>
  );
};

export default App;
