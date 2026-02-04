
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

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

const normalizeCards = (data: any[]): CardData[] => {
  if (!Array.isArray(data)) return [];
  return data.map(c => {
    if (!c) return null;
    return {
      ...c,
      id: c.id || generateId(),
      status: c.status || (c.overallGrade ? 'reviewed' : 'needs_review'),
      timestamp: c.timestamp || Date.now(),
      gradingSystem: 'NGA',
      isSynced: typeof c.isSynced === 'boolean' ? c.isSynced : true
    } as CardData;
  }).filter((c): c is CardData => c !== null);
};

const App: React.FC = () => {
  // Auto-resize for iframe hosting
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
  
  // Exhaustive Data Recovery: Scans EVERYTHING in local storage
  const [cards, setCards] = useState<CardData[]>(() => {
    let recovered: any[] = [];
    
    // 1. Try primary storage
    const primary = localStorage.getItem(LOCAL_CARDS_STORAGE);
    if (primary) try { recovered = JSON.parse(primary); } catch(e) {}

    // 2. Global Sweep: Look at every key for potential card arrays
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key !== LOCAL_CARDS_STORAGE) {
        try {
          const val = localStorage.getItem(key);
          if (val && (val.includes('frontImage') || val.includes('overallGrade'))) {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              parsed.forEach(pCard => {
                // Deduplicate by name and timestamp
                const isDupe = recovered.find(rc => rc.id === pCard.id || (rc.name === pCard.name && Math.abs(rc.timestamp - pCard.timestamp) < 5000));
                if (!isDupe) recovered.push(pCard);
              });
            }
          }
        } catch(e) {}
      }
    }
    return normalizeCards(recovered);
  });

  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const processingCards = useRef(new Set<string>());
  const lastSavedRef = useRef('');

  // API Key Selection logic
  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
        // We don't force it here to avoid annoying popups, 
        // but we ensure the mechanism is available in settings.
        console.log("No API key selected in AI Studio context.");
      }
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_CARDS_STORAGE, JSON.stringify(cards));
  }, [cards]);

  const refreshCollection = useCallback(async (silent: boolean = false) => {
    if (!user || !getAccessToken) return;
    setSyncStatus('loading');
    try {
      const token = await getAccessToken(silent);
      const { fileId, cards: remoteData } = await getCollection(token);
      const remoteCards = normalizeCards(remoteData);
      
      setCards(prev => {
        const merged = [...prev];
        let added = 0;
        remoteCards.forEach(rc => {
          const exists = merged.find(m => m.id === rc.id || (m.name === rc.name && m.frontImage === rc.frontImage));
          if (!exists) { merged.push(rc); added++; }
          else { 
            const idx = merged.indexOf(exists);
            merged[idx] = { ...exists, ...rc };
          }
        });
        if (!silent) {
          if (added > 0) alert(`Success! Recovered ${added} cards from Google Drive.`);
          else if (remoteCards.length > 0) alert("Collection is already up to date.");
          else alert("No collection files were found in this Drive account.");
        }
        return merged.sort((a, b) => b.timestamp - a.timestamp);
      });
      setDriveFileId(fileId);
      setSyncStatus('success');
    } catch (e) {
      setSyncStatus('error');
      if (!silent) alert("Sync failed. Please check your internet connection.");
    }
  }, [user, getAccessToken]);

  useEffect(() => {
    if (user && isAuthReady) refreshCollection(true);
  }, [user, isAuthReady, refreshCollection]);

  const handleSyncFromSheet = useCallback(async () => {
    if (!user || !getAccessToken) return;
    const url = localStorage.getItem(SHEET_URL_STORAGE);
    if (!url) { alert("Please set your Google Sheet URL in settings."); return; }
    try {
      const token = await getAccessToken();
      const sheetCards = await fetchCardsFromSheet(token, url);
      setCards(prev => {
        const merged = [...prev];
        let added = 0;
        sheetCards.forEach(sc => {
          if (!merged.find(m => m.id === sc.id || (m.name === sc.name && m.year === sc.year))) {
            merged.push(sc);
            added++;
          }
        });
        if (added > 0) alert(`Imported ${added} new records from sheet.`);
        return merged.sort((a, b) => b.timestamp - a.timestamp);
      });
    } catch (e: any) { alert("Sheet sync failed: " + e.message); }
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

      setCards(prev => prev.map(c => c.id === card.id ? { ...c, ...updates, status: nextStatus, isSynced: false } : c));
    } catch (e: any) {
      if (e.message === 'API_KEY_MISSING' && window.aistudio) {
          window.aistudio.openSelectKey();
      }
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'grading_failed', errorMessage: e.message } : c));
    } finally { processingCards.current.delete(card.id); }
  }, []);

  useEffect(() => {
    const queue = cards.filter(c => ['grading', 'challenging', 'regenerating_summary', 'generating_summary', 'fetching_value'].includes(c.status) && !processingCards.current.has(c.id));
    if (queue.length > 0 && processingCards.current.size < 2) queue.slice(0, 2 - processingCards.current.size).forEach(processCard);
  }, [cards, processCard]);

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
    }, 30000);
    return () => clearTimeout(timer);
  }, [cards, user, getAccessToken, driveFileId]);

  return (
    <div className="min-h-screen flex flex-col items-center p-4">
      <header className="w-full max-w-4xl flex justify-between items-center p-4 gap-4">
        <img src="https://mcusercontent.com/d7331d7f90c4b088699bd7282/images/98cb8f09-7621-798a-803a-26d394c7b10f.png" alt="Logo" className="h-10" />
        <div className="flex gap-2">
          {user && (
            <button onClick={() => setView(view === 'history' ? 'scanner' : 'history')} className="flex items-center gap-2 py-2 px-4 bg-white/70 rounded-lg shadow-md border border-slate-300">
              <HistoryIcon className="h-5 w-5" /> Collection
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
            onRetryGrading={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'grading' } : x))}
            onAcceptGrade={id => setCards(cur => cur.map(c => c.id === id ? { ...c, status: 'fetching_value' } : c))}
            onManualGrade={(c, g, n) => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'regenerating_summary', overallGrade: g, gradeName: n } : x))}
            onLoadCollection={() => refreshCollection(false)} onSyncFromSheet={handleSyncFromSheet}
            onGetMarketValue={c => setCards(cur => cur.map(x => x.id === c.id ? { ...x, status: 'fetching_value' } : x))}
            userName={user?.name || ''} 
            onResync={async () => {}} onRewriteAllAnalyses={async () => {}} resetRewriteState={() => {}}
            isRewriting={false} rewriteProgress={0} rewrittenCount={0} rewriteFailCount={0} rewriteStatusMessage={''}
          />
        ) : (
          <CardScanner onRatingRequest={(f, b) => { setCards(cur => [{ id: generateId(), frontImage: f, backImage: b, timestamp: Date.now(), gradingSystem: 'NGA', status: 'grading' }, ...cur]); setView('history'); }} isGrading={cards.some(c => c.status === 'grading')} isLoggedIn={!!user} hasCards={cards.length > 0} onSyncDrive={() => refreshCollection(false)} isSyncing={syncStatus === 'loading'} />
        )}
      </main>
    </div>
  );
};

export default App;
