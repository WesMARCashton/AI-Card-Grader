
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CardData, AppView, User } from './types';
import { CardScanner } from './components/CardScanner';
import { CardHistory } from './components/CardHistory';
import { Auth } from './components/Auth';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import { 
  challengeGrade, 
  regenerateCardAnalysisForGrade,
  analyzeCardFull,
  getCardMarketValue
} from './services/geminiService';
import { getCollection, saveCollection } from './services/driveService';
import { fetchCardsFromSheet } from './services/sheetsService';
import { HistoryIcon, SpinnerIcon } from './components/icons';
import { dataUrlToBase64 } from './utils/fileUtils';
import { ApiKeyModal } from './components/ApiKeyModal';

const MANUAL_API_KEY_STORAGE = 'manual_gemini_api_key';
const SHEET_URL_STORAGE = 'google_sheet_url';

if (typeof window !== 'undefined') {
  if (!(window as any).process) (window as any).process = { env: {} };
  const savedKey = localStorage.getItem(MANUAL_API_KEY_STORAGE);
  if (savedKey) (process.env as any).API_KEY = savedKey;
}

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

const App: React.FC = () => {
  // ---- iframe auto-resize: report app height to parent (WordPress) ----
  useEffect(() => {
    const PARENT_ORIGIN = "https://ngacard.com";

    const sendHeight = () => {
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.offsetHeight,
        document.body.offsetHeight
      );

      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          { type: "NGA_IFRAME_HEIGHT", height },
          PARENT_ORIGIN
        );
      }
    };

    sendHeight();

    let ro: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(() => sendHeight());
      ro.observe(document.documentElement);
    }

    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === "NGA_IFRAME_PING") sendHeight();
    };
    window.addEventListener("message", onMsg);

    return () => {
      ro && ro.disconnect();
      window.removeEventListener("message", onMsg);
    };
  }, []);
  // ---- end iframe auto-resize ----

  const { user, signOut, getAccessToken, isAuthReady } = useGoogleAuth();
  
  const [view, setView] = useState<AppView>('scanner');
  const [cards, setCards] = useState<CardData[]>([]);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  const processingCards = useRef(new Set<string>());
  const lastSavedCardsRef = useRef<string>('');
  const CONCURRENCY_LIMIT = 2;

  const refreshCollection = useCallback(async (silent: boolean = false) => {
    if (!user || !getAccessToken) return;
    setSyncStatus('loading');
    try {
      const token = await getAccessToken(silent);
      const { fileId, cards: loadedCards } = await getCollection(token);
      setCards(loadedCards || []);
      setDriveFileId(fileId);
      setSyncStatus('success');
      lastSavedCardsRef.current = JSON.stringify(loadedCards || []);
    } catch (err: any) {
      console.error("Refresh collection failed:", err);
      setSyncStatus(silent ? 'idle' : 'error');
    }
  }, [user, getAccessToken]);

  const handleSyncFromSheet = useCallback(async () => {
    if (!user || !getAccessToken) return;
    const sheetUrl = localStorage.getItem(SHEET_URL_STORAGE);
    if (!sheetUrl) {
      alert("Please set a Google Sheet URL in settings first.");
      return;
    }

    try {
      const token = await getAccessToken(false);
      const sheetCards = await fetchCardsFromSheet(token, sheetUrl);
      
      if (sheetCards.length === 0) {
        alert("No valid records found in the spreadsheet.");
        return;
      }

      setCards(prev => {
        // Build a unique fingerprint for existing cards that HAVE images
        // Fingerprint includes Grade and Company to prevent collapsing player duplicates
        const existingFingerprints = new Set(
          prev
            .filter(c => c.frontImage || c.backImage)
            .map(c => `${c.name}|${c.year}|${c.company}|${c.set}|${c.cardNumber}|${c.overallGrade}`.toLowerCase())
        );

        // Also track IDs to prevent duplicate sheet row imports
        const existingIds = new Set(prev.map(c => c.id));

        const newToMerge = sheetCards.filter(sc => {
          if (existingIds.has(sc.id)) return false;
          
          const fingerprint = `${sc.name}|${sc.year}|${sc.company}|${sc.set}|${sc.cardNumber}|${sc.overallGrade}`.toLowerCase();
          // If we have an image-based local copy, don't import the imageless sheet row as a duplicate
          return !existingFingerprints.has(fingerprint);
        });

        const combined = [...prev, ...newToMerge];
        // Sort descending by timestamp
        return combined.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
      
      alert(`Sync Complete!\n\nSuccessfully retrieved ${sheetCards.length} rows from the Master Sheet.`);
    } catch (err: any) {
      console.error("Sync from sheet failed:", err);
      alert("Error syncing from sheet: " + err.message);
      throw err;
    }
  }, [user, getAccessToken]);

  useEffect(() => {
    if (user && isAuthReady) {
      refreshCollection(true);
    }
  }, [user, isAuthReady, refreshCollection]);

  useEffect(() => {
    const saveTimeout = setTimeout(async () => {
      const criticalProcessing = cards.some(c => ['grading', 'challenging', 'regenerating_summary'].includes(c.status));
      const currentCardsStr = JSON.stringify(cards);
      
      if (user && getAccessToken && !criticalProcessing && currentCardsStr !== lastSavedCardsRef.current) {
        try {
          const token = await getAccessToken(true);
          const newFileId = await saveCollection(token, driveFileId, cards);
          setDriveFileId(newFileId);
          lastSavedCardsRef.current = currentCardsStr;
        } catch (err) {
          console.error("Auto-save failed:", err);
        }
      }
    }, 3000);

    return () => clearTimeout(saveTimeout);
  }, [cards, user, getAccessToken, driveFileId]);

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
          finalCardData = await analyzeCardFull(f64, b64);
          finalStatus = 'needs_review';
          break;
        case 'challenging':
          finalCardData = await challengeGrade(cardToProcess, cardToProcess.challengeDirection!, () => {});
          finalStatus = 'needs_review';
          break;
        case 'regenerating_summary':
          finalCardData = await regenerateCardAnalysisForGrade(f64, b64, cardToProcess, cardToProcess.overallGrade!, cardToProcess.gradeName!, () => {});
          finalStatus = 'reviewed';
          break;
        case 'fetching_value':
          finalCardData = { marketValue: await getCardMarketValue(cardToProcess) };
          finalStatus = 'reviewed';
          break;
        default:
          processingCards.current.delete(cardToProcess.id);
          return;
      }
      
      setCards(current => current.map(c => 
        c.id === cardToProcess.id ? { ...c, ...finalCardData, status: finalStatus, isSynced: false } : c
      ));
    } catch (err: any) {
      console.error(`Error processing card ${cardToProcess.id}:`, err);
      if (err.message === "API_KEY_MISSING") setShowApiKeyModal(true);
      setCards(current => current.map(c => 
        c.id === cardToProcess.id ? { ...c, status: 'grading_failed' as const, errorMessage: err.message } : c
      ));
    } finally {
      processingCards.current.delete(cardToProcess.id);
    }
  }, []);

  useEffect(() => {
    const queue = cards.filter(c => 
      ['grading', 'challenging', 'regenerating_summary', 'fetching_value'].includes(c.status) && 
      !processingCards.current.has(c.id)
    );
    
    if (queue.length > 0 && processingCards.current.size < CONCURRENCY_LIMIT) {
      queue.slice(0, CONCURRENCY_LIMIT - processingCards.current.size).forEach(c => processCardInBackground(c));
    }
  }, [cards, processCardInBackground]);

  const handleRatingRequest = useCallback((f: string, b: string) => {
    const newCard: CardData = { 
      id: generateId(), 
      frontImage: f, 
      backImage: b, 
      timestamp: Date.now(), 
      gradingSystem: 'NGA', 
      isSynced: false, 
      status: 'grading' 
    };
    
    setView('history');
    setCards(current => [newCard, ...current]);
  }, []);

  const isBlockingProcessing = cards.some(c => ['grading', 'challenging', 'regenerating_summary'].includes(c.status));

  return (
    <div className="min-h-screen font-sans flex flex-col items-center p-4">
      <header className="w-full max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center p-4 gap-4">
        <div className="flex items-center gap-4">
          <img src="https://mcusercontent.com/d7331d7f90c4b088699bd7282/images/98cb8f09-7621-798a-803a-26d394c7b10f.png" alt="Logo" className="h-10 w-auto" />
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <button onClick={() => setView(view === 'history' ? 'scanner' : 'history')} className="flex items-center gap-2 py-2 px-4 bg-white/70 hover:bg-white text-slate-800 font-semibold rounded-lg shadow-md transition border border-slate-300">
              <HistoryIcon className="h-5 w-5" />
              <span className="hidden sm:inline">My Collection</span>
            </button>
          )}
          <Auth user={user} onSignOut={signOut} isAuthReady={isAuthReady} />
        </div>
      </header>
      <main className="w-full flex-grow flex flex-col items-center">
        {view === 'history' ? (
          <CardHistory 
            cards={cards} 
            onBack={() => setView('scanner')} 
            onDelete={id => setCards(cur => cur.filter(c => c.id !== id))} 
            getAccessToken={() => getAccessToken(false)} 
            onCardsSynced={synced => setCards(cur => cur.map(c => synced.some(s => s.id === c.id) ? { ...c, isSynced: true } : c))}
            onChallengeGrade={(c, d) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'challenging', challengeDirection: d } : x))}
            onResync={async () => {}}
            onRetryGrading={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'grading', errorMessage: undefined } : x))}
            onRewriteAllAnalyses={async () => {}}
            resetRewriteState={() => {}}
            isRewriting={false} rewriteProgress={0} rewrittenCount={0} rewriteFailCount={0} rewriteStatusMessage={''}
            onAcceptGrade={id => setCards(cur => cur.map(c => c.id === id ? { ...c, status: 'fetching_value' } : c))}
            onManualGrade={(c, g, n) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'regenerating_summary', overallGrade: g, gradeName: n } : x))}
            onLoadCollection={() => refreshCollection(false)} 
            onSyncFromSheet={handleSyncFromSheet}
            onGetMarketValue={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'fetching_value' } : x))}
            userName={user?.name || 'Anonymous'}
          />
        ) : (
          <CardScanner 
            onRatingRequest={handleRatingRequest} 
            isGrading={isBlockingProcessing} 
            gradingStatus={isBlockingProcessing ? 'Grading card...' : ''} 
            isLoggedIn={!!user}
            hasCards={cards.length > 0}
            onSyncDrive={() => refreshCollection(false)}
            isSyncing={syncStatus === 'loading'}
          />
        )}
        
        {showApiKeyModal && (
          <ApiKeyModal 
            onSave={key => { localStorage.setItem(MANUAL_API_KEY_STORAGE, key); setShowApiKeyModal(false); window.location.reload(); }}
            onClose={() => setShowApiKeyModal(false)}
          />
        )}
      </main>
    </div>
  );
};

export default App;
