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
import { HistoryIcon, KeyIcon, SpinnerIcon, CheckIcon } from './components/icons';
import { dataUrlToBase64 } from './utils/fileUtils';
import { SyncSheetModal } from './components/SyncSheetModal';
import { ApiKeyModal } from './components/ApiKeyModal';

const BACKUP_KEY = 'nga_card_backup';
const MANUAL_API_KEY_STORAGE = 'manual_gemini_api_key';

// Global shim that runs once on import
if (typeof window !== 'undefined') {
  if (!(window as any).process) (window as any).process = { env: {} };
  const savedKey = localStorage.getItem(MANUAL_API_KEY_STORAGE);
  if (savedKey) {
    (process.env as any).API_KEY = savedKey;
  }
}

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
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [cardsToResyncManually, setCardsToResyncManually] = useState<CardData[]>([]);
  const [hasApiKey, setHasApiKey] = useState(!!localStorage.getItem(MANUAL_API_KEY_STORAGE) || !!process.env.API_KEY);

  const processingCards = useRef(new Set<string>());
  const CONCURRENCY_LIMIT = 2;

  const handleOpenKeySelector = useCallback(async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio && typeof aistudio.openSelectKey === 'function') {
      try {
        await aistudio.openSelectKey();
        setHasApiKey(true);
      } catch (e) {
        setShowApiKeyModal(true);
      }
    } else {
      setShowApiKeyModal(true);
    }
  }, []);

  const handleSaveManualKey = (key: string) => {
    localStorage.setItem(MANUAL_API_KEY_STORAGE, key);
    if (!(window as any).process) (window as any).process = { env: {} };
    (process.env as any).API_KEY = key;
    setHasApiKey(true);
    setShowApiKeyModal(false);
    setError(null);
    
    // Auto-retry any failed cards once a key is added
    setCards(current => current.map(c => c.status === 'grading_failed' ? { ...c, status: 'grading', errorMessage: undefined } : c));
  };

  useEffect(() => {
    if (cards.length > 0) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(cards));
      } catch (e) {
        console.warn("Local backup failed", e);
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
                return { ...c, status: 'grading_failed' as const, errorMessage: 'Recovered after crash.' };
              }
              return c;
            });
            setCards(current => current.length === 0 ? recoveredCards : current);
          }
        } catch (e) {
          console.error("Failed to parse backup", e);
        }
      }
    } else {
      setCards([]);
      setDriveFileId(null);
      setError(null);
    }
  }, [user]);

  const handleSyncWithDrive = useCallback(async (silent: boolean = false) => {
    if (!user || !getAccessToken) return;
    setSyncStatus('loading');
    try {
      const token = await getAccessToken(silent);
      const { fileId, cards: loadedCards } = await getCollection(token);
      setCards(loadedCards || []);
      setDriveFileId(fileId);
      setSyncStatus('success');
      if (!silent) setView('history');
    } catch (err: any) {
      setSyncStatus('error');
    }
  }, [user, getAccessToken]);

  const saveCollectionToDrive = useCallback(async (cardsToSave: CardData[]) => {
    if (!user || !getAccessToken) return;
    try {
      const token = await getAccessToken(true); 
      await saveCollection(token, driveFileId, cardsToSave);
    } catch (err: any) {}
  }, [user, getAccessToken, driveFileId]);

  const processCardInBackground = useCallback(async (cardToProcess: CardData) => {
    if (processingCards.current.has(cardToProcess.id)) return;
    processingCards.current.add(cardToProcess.id);
  
    try {
      let finalCardData: Partial<CardData> = {};
      let finalStatus: CardData['status'] = 'needs_review';
      const f64 = dataUrlToBase64(cardToProcess.frontImage);
      const b64 = dataUrlToBase64(cardToProcess.backImage);

      switch (cardToProcess.status) {
        case 'grading':
          const [idInfo, gradeInfo] = await Promise.all([identifyCard(f64, b64), gradeCardPreliminary(f64, b64)]);
          finalCardData = { ...idInfo, ...gradeInfo };
          break;
        case 'generating_summary':
          finalCardData = { summary: await generateCardSummary(f64, b64, cardToProcess) };
          finalStatus = 'fetching_value' as const;
          break;
        case 'challenging':
          finalCardData = { ...await challengeGrade(cardToProcess, cardToProcess.challengeDirection!, () => {}), challengeDirection: undefined };
          finalStatus = 'needs_review' as const;
          break;
        case 'regenerating_summary':
          finalCardData = await regenerateCardAnalysisForGrade(f64, b64, cardToProcess, cardToProcess.overallGrade!, cardToProcess.gradeName!, () => {});
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
      if (err.message === "API_KEY_MISSING") handleOpenKeySelector();
      setCards(current => {
        const updated = current.map(c => c.id === cardToProcess.id ? { ...c, status: 'grading_failed' as const, errorMessage: err.message } : c);
        saveCollectionToDrive(updated);
        return updated;
      });
    } finally {
      processingCards.current.delete(cardToProcess.id);
    }
  }, [saveCollectionToDrive, handleOpenKeySelector]);

  useEffect(() => {
    const queue = cards.filter(c => ['grading', 'challenging', 'regenerating_summary', 'generating_summary', 'fetching_value'].includes(c.status) && !processingCards.current.has(c.id));
    if (queue.length > 0 && processingCards.current.size < CONCURRENCY_LIMIT) {
      queue.slice(0, CONCURRENCY_LIMIT - processingCards.current.size).forEach(c => processCardInBackground(c));
    }
  }, [cards, processCardInBackground]);

  const handleRatingRequest = useCallback(async (f: string, b: string) => {
    const newCard: CardData = { id: generateId(), frontImage: f, backImage: b, timestamp: Date.now(), gradingSystem: 'NGA', isSynced: false, status: 'grading' };
    setCards(current => {
        const updated = [newCard, ...current];
        saveCollectionToDrive(updated);
        return updated;
    });
  }, [saveCollectionToDrive]);

  return (
    <div className="min-h-screen font-sans flex flex-col items-center p-4">
        <header className="w-full max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center p-4 gap-4">
            <div className="flex items-center gap-4">
              <img src="https://mcusercontent.com/d7331d7f90c4b088699bd7282/images/98cb8f09-7621-798a-803a-26d394c7b10f.png" alt="MARC AI Grader Logo" className="h-10 w-auto" />
              <button 
                onClick={handleOpenKeySelector} 
                className={`p-2 flex items-center gap-2 px-3 rounded-full transition shadow-sm border ${hasApiKey ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-100 border-slate-200 text-slate-600'}`}
              >
                <KeyIcon className="w-5 h-5" />
                <span className="text-xs font-bold">{hasApiKey ? 'API Active' : 'Setup API'}</span>
              </button>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {user && (
                  <button onClick={() => setView(view === 'history' ? 'scanner' : 'history')} className="flex items-center gap-2 py-2 px-4 bg-white/70 hover:bg-white text-slate-800 font-semibold rounded-lg shadow-md transition border border-slate-300">
                    <HistoryIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">{view === 'history' ? 'Scanner' : `Collection (${cards.length})`}</span>
                  </button>
                )}
                <Auth user={user} onSignOut={signOut} isAuthReady={isAuthReady} />
              </div>
            </div>
        </header>
        <main className="w-full flex-grow flex flex-col justify-center items-center">
            {view === 'history' ? (
                <CardHistory 
                  cards={cards} 
                  onBack={() => setView('scanner')} 
                  onDelete={id => setCards(cur => { const upd = cur.filter(c => c.id !== id); saveCollectionToDrive(upd); return upd; })} 
                  getAccessToken={() => getAccessToken(false)} 
                  onCardsSynced={c => setCards(cur => cur.map(card => c.some(s => s.id === card.id) ? { ...card, isSynced: true } : card))}
                  onChallengeGrade={(c, d) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'challenging', challengeDirection: d } : x))}
                  onResync={async (c) => {}}
                  onRetryGrading={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'grading', errorMessage: undefined } : x))}
                  onRewriteAllAnalyses={async () => {}}
                  resetRewriteState={() => {}}
                  isRewriting={isRewriting} rewriteProgress={rewriteProgress} rewrittenCount={rewrittenCount} rewriteFailCount={rewriteFailCount} rewriteStatusMessage={rewriteStatusMessage}
                  onAcceptGrade={id => setCards(cur => cur.map(c => c.id === id ? { ...c, status: 'generating_summary' } : c))}
                  onManualGrade={(c, g, n) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'regenerating_summary', overallGrade: g, gradeName: n } : x))}
                  onLoadCollection={() => handleSyncWithDrive(false)} 
                  onGetMarketValue={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'fetching_value' } : x))}
                />
            ) : (
                <CardScanner 
                  onRatingRequest={handleRatingRequest} 
                  isGrading={isGrading} 
                  gradingStatus={gradingStatus} 
                  isLoggedIn={!!user}
                  hasCards={cards.length > 0}
                  onSyncDrive={() => handleSyncWithDrive(false)}
                  isSyncing={syncStatus === 'loading'}
                />
            )}
            
            {showApiKeyModal && (
              <ApiKeyModal 
                onSave={handleSaveManualKey}
                onClose={() => setShowApiKeyModal(false)}
              />
            )}
        </main>
    </div>
  );
};

export default App;
