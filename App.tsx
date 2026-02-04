
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

const SHEET_URL_STORAGE = 'google_sheet_url';
const LOCAL_CARDS_STORAGE = 'nga_card_collection_local';
const API_KEY_STORAGE_KEY = 'manual_gemini_api_key';

if (typeof window !== 'undefined') {
    const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedKey) {
        (process.env as any).API_KEY = savedKey;
    }
}

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

const normalizeCards = (data: any[]): CardData[] => {
  if (!Array.isArray(data)) return [];
  return data.map(c => {
    if (!c || typeof c !== 'object') return null;
    return {
      ...c,
      id: c.id || generateId(),
      status: c.status || (c.overallGrade ? 'reviewed' : 'needs_review'),
      timestamp: c.timestamp || Date.now(),
      gradingSystem: 'NGA',
      isSynced: typeof c.isSynced === 'boolean' ? c.isSynced : true,
      frontImage: c.frontImage || '',
      backImage: c.backImage || ''
    } as CardData;
  }).filter((c): c is CardData => c !== null);
};

const App: React.FC = () => {
  useEffect(() => {
    const PARENT_ORIGIN = "https://ngacard.com";
    const sendHeight = () => {
      const height = document.documentElement.scrollHeight;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "NGA_IFRAME_HEIGHT", height }, PARENT_ORIGIN);
      }
    };
    sendHeight();
    const ro = new ResizeObserver(() => sendHeight());
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  const { user, signOut, getAccessToken, isAuthReady } = useGoogleAuth();
  const [view, setView] = useState<AppView>('scanner');
  const [quotaPause, setQuotaPause] = useState(false);
  
  const [cards, setCards] = useState<CardData[]>(() => {
    const recoveredMap = new Map<string, any>();
    const addToMapRecursive = (data: any) => {
        if (!data) return;
        if (typeof data === 'object' && !Array.isArray(data)) {
            if (data.frontImage && (data.id || data.name || data.overallGrade !== undefined)) {
                const key = data.id || `${data.name}-${data.timestamp || Date.now()}`;
                if (!recoveredMap.has(key)) {
                    recoveredMap.set(key, data);
                    return;
                }
            }
            Object.values(data).forEach(val => {
                if (val && typeof val === 'object') addToMapRecursive(val);
            });
        } else if (Array.isArray(data)) {
            data.forEach(item => addToMapRecursive(item));
        }
    };
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        try {
          const val = localStorage.getItem(key);
          if (val && (val.startsWith('[') || val.startsWith('{'))) {
             if (val.includes('frontImage') || val.includes('overallGrade') || val.includes('backImage')) {
                 const parsed = JSON.parse(val);
                 addToMapRecursive(parsed);
             }
          }
        } catch(e) {}
      }
    }
    const finalCards = Array.from(recoveredMap.values());
    return normalizeCards(finalCards);
  });

  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const processingCards = useRef(new Set<string>());
  const lastSavedRef = useRef('');

  useEffect(() => {
    localStorage.setItem(LOCAL_CARDS_STORAGE, JSON.stringify(cards));
  }, [cards]);

  const refreshCollection = useCallback(async (silent: boolean = false) => {
    if (!user || !getAccessToken) return;
    setSyncStatus('loading');
    try {
      const token = await getAccessToken(silent);
      const { fileId, cards: remoteData } = await getCollection(token);
      if (remoteData && remoteData.length > 0) {
          const remoteCards = normalizeCards(remoteData);
          setCards(prev => {
            const merged = [...prev];
            remoteCards.forEach(rc => {
              const exists = merged.find(m => m.id === rc.id || (m.name === rc.name && m.frontImage === rc.frontImage));
              if (!exists) merged.push(rc); 
              else { 
                const idx = merged.indexOf(exists);
                merged[idx] = { ...exists, ...rc };
              }
            });
            return merged.sort((a, b) => b.timestamp - a.timestamp);
          });
      }
      setDriveFileId(fileId);
      setSyncStatus('success');
    } catch (e) {
      setSyncStatus('error');
    }
  }, [user, getAccessToken]);

  useEffect(() => {
    if (user && isAuthReady) refreshCollection(true);
  }, [user, isAuthReady, refreshCollection]);

  const handleSyncFromSheet = useCallback(async () => {
    if (!user || !getAccessToken) return;
    const url = localStorage.getItem(SHEET_URL_STORAGE);
    if (!url) return;
    try {
      const token = await getAccessToken();
      const sheetCards = await fetchCardsFromSheet(token, url);
      setCards(prev => {
        const merged = [...prev];
        sheetCards.forEach(sc => {
          if (!merged.find(m => m.id === sc.id || (m.name === sc.name && m.year === sc.year))) {
            merged.push(sc);
          }
        });
        return merged.sort((a, b) => b.timestamp - a.timestamp);
      });
    } catch (e: any) {}
  }, [user, getAccessToken]);

  const processCard = useCallback(async (card: CardData) => {
    if (processingCards.current.has(card.id)) return;
    processingCards.current.add(card.id);
    try {
      const f64 = dataUrlToBase64(card.frontImage);
      const b64 = dataUrlToBase64(card.backImage);
      let updates: Partial<CardData> = {};
      let nextStatus: CardData['status'] = 'needs_review';

      if (card.status === 'grading') {
        updates = await analyzeCardFull(f64, b64);
      } else if (card.status === 'challenging') {
        updates = await challengeGrade(card, card.challengeDirection!, () => {});
      } else if (card.status === 'regenerating_summary' || card.status === 'generating_summary') {
        updates = await regenerateCardAnalysisForGrade(f64, b64, card, card.overallGrade!, card.gradeName!, () => {});
        nextStatus = 'reviewed';
      } else if (card.status === 'fetching_value') {
        updates = { marketValue: await getCardMarketValue(card) };
        nextStatus = 'reviewed';
      }

      setCards(prev => prev.map(c => c.id === card.id ? { ...c, ...updates, status: nextStatus, isSynced: false, errorMessage: undefined } : c));
      setQuotaPause(false); 
    } catch (e: any) {
      if (e.message === 'SEARCH_BILLING_ISSUE' || e.message === 'BILLING_LINK_REQUIRED') {
          // If pricing specifically fails due to billing, mark card as reviewed but note the error
          setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'reviewed', errorMessage: "Price Search restricted. Billing or Fresh API Key required." } : c));
          setQuotaPause(true);
          setView('history');
          return;
      } else if (e.message === 'SEARCH_QUOTA_EXHAUSTED' || e.message === 'QUOTA_EXHAUSTED') {
          setQuotaPause(true);
          setTimeout(() => setQuotaPause(false), 30000); 
      }
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'grading_failed', errorMessage: e.message } : c));
    } finally { processingCards.current.delete(card.id); }
  }, []);

  useEffect(() => {
    if (quotaPause) return; 
    const queue = cards.filter(c => ['grading', 'challenging', 'regenerating_summary', 'generating_summary', 'fetching_value'].includes(c.status) && !processingCards.current.has(c.id));
    if (queue.length > 0 && processingCards.current.size < 1) {
        queue.slice(0, 1).forEach(processCard);
    }
  }, [cards, processCard, quotaPause]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const str = JSON.stringify(cards);
      if (user && getAccessToken && str !== lastSavedRef.current && cards.length > 0) {
        try {
          const token = await getAccessToken(true);
          const newId = await saveCollection(token, driveFileId, cards);
          setDriveFileId(newId);
          lastSavedRef.current = str;
        } catch(e) {}
      }
    }, 60000);
    return () => clearTimeout(timer);
  }, [cards, user, getAccessToken, driveFileId]);

  return (
    <div className="min-h-screen flex flex-col items-center p-4">
      <header className="w-full max-w-4xl flex justify-between items-center p-4 gap-4">
        <img src="https://mcusercontent.com/d7331d7f90c4b088699bd7282/images/98cb8f09-7621-798a-803a-26d394c7b10f.png" alt="Logo" className="h-10" />
        <div className="flex gap-2">
          {user && (
            <button onClick={() => setView(view === 'history' ? 'scanner' : 'history')} className="flex items-center gap-2 py-2 px-4 bg-white/70 rounded-lg shadow-md border border-slate-300 transition hover:bg-white text-slate-800 font-semibold">
              <HistoryIcon className="h-5 w-5 text-blue-500" /> Collection ({cards.length})
            </button>
          )}
          <Auth user={user} onSignOut={signOut} isAuthReady={isAuthReady} />
        </div>
      </header>
      <main className="w-full">
        {view === 'history' ? (
          <CardHistory 
            cards={cards} onBack={() => setView('scanner')} onDelete={id => setCards(cur => cur.filter(c => c.id !== id))} 
            getAccessToken={() => getAccessToken(false)} onCardsSynced={synced => setCards(cur => cur.map(c => synced.some(s => s.id === c.id) ? { ...c, isSynced: true } : c))}
            onChallengeGrade={(c, d) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'challenging', challengeDirection: d } : x))}
            onRetryGrading={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'grading', errorMessage: undefined } : x))}
            onAcceptGrade={id => setCards(cur => cur.map(c => c.id === id ? { ...c, status: 'fetching_value', errorMessage: undefined } : c))}
            onManualGrade={(c, g, n) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'regenerating_summary', overallGrade: g, gradeName: n } : x))}
            onLoadCollection={() => refreshCollection(false)} onSyncFromSheet={handleSyncFromSheet}
            onGetMarketValue={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'fetching_value', errorMessage: undefined } : x))}
            userName={user?.name || ''} 
            onResync={async () => {}} onRewriteAllAnalyses={async () => {}} resetRewriteState={() => {}}
            isRewriting={false} rewriteProgress={0} rewrittenCount={0} rewriteFailCount={0} rewriteStatusMessage={''}
          />
        ) : (
          <CardScanner onRatingRequest={(f, b) => { setCards(cur => [{ id: generateId(), frontImage: f, backImage: b, timestamp: Date.now(), gradingSystem: 'NGA', status: 'grading' }, ...cur]); setView('history'); }} isGrading={cards.some(c => ['grading', 'challenging'].includes(c.status))} isLoggedIn={!!user} hasCards={cards.length > 0} onSyncDrive={() => refreshCollection(false)} isSyncing={syncStatus === 'loading'} />
        )}
      </main>
      {quotaPause && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:w-96 bg-blue-900 text-white p-3 rounded-lg shadow-xl flex items-center gap-3 animate-slide-up z-50">
           <SpinnerIcon className="w-5 h-5 text-blue-300" />
           <div>
             <p className="text-xs font-bold">Speed Limit Reached</p>
             <p className="text-[10px] text-blue-200">Automatically resuming in 30s...</p>
           </div>
           <button onClick={() => setQuotaPause(false)} className="text-[10px] bg-blue-700 hover:bg-blue-600 px-2 py-1 rounded font-bold ml-auto">Resume Now</button>
        </div>
      )}
    </div>
  );
};

export default App;
