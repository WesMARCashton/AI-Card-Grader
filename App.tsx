
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
  saveManualApiKey
} from './services/geminiService';
import { getCollection, saveCollection } from './services/driveService';
import { syncToSheet } from './services/sheetsService';
import { HistoryIcon, ResyncIcon, SpinnerIcon, KeyIcon } from './components/icons';
import { dataUrlToBase64 } from './utils/fileUtils';
import { ApiKeyModal } from './components/ApiKeyModal';

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';

const BACKUP_KEY = 'nga_card_backup';

// Robust ID generator that works in all contexts (secure and non-secure)
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments where crypto.randomUUID is not available
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteProgress, setRewriteProgress] = useState(0);
  const [rewrittenCount, setRewrittenCount] = useState(0);
  const [rewriteFailCount, setRewriteFailCount] = useState(0);
  const [rewriteStatusMessage, setRewriteStatusMessage] = useState('');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  
  // Ref to track which cards are currently being processed to prevent duplicates
  const processingCards = useRef(new Set<string>());
  const CONCURRENCY_LIMIT = 2; // Process up to 2 cards at a time to avoid rate limits
  
  // --- CRASH RECOVERY & BACKUP SYSTEM ---

  // 1. Save to Local Storage on every change
  useEffect(() => {
    if (cards.length > 0) {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(cards));
    }
  }, [cards]);

  // 2. Restore from Local Storage on Login
  useEffect(() => {
    if (user) {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (backup) {
        try {
          const savedCards: CardData[] = JSON.parse(backup);
          if (savedCards.length > 0) {
            // Check for "Stuck" cards (cards that were processing when app crashed)
            const recoveredCards = savedCards.map(c => {
              if (['grading', 'challenging', 'regenerating_summary', 'generating_summary'].includes(c.status)) {
                return { 
                  ...c, 
                  status: 'grading_failed' as const, 
                  errorMessage: 'Recovered from session crash. Please retry.' 
                };
              }
              return c;
            });

            // Only restore if we don't have cards yet (e.g., initial load)
            // This acts as a cache-first strategy to ensure we don't lose unsynced work
            setCards(current => {
              if (current.length === 0) {
                return recoveredCards;
              }
              return current;
            });
          }
        } catch (e) {
          console.error("Failed to parse local backup", e);
        }
      }
    } else {
      // Clear state on logout
      setCards([]);
      setDriveFileId(null);
      setSyncStatus('idle');
      setError(null);
      setIsRewriting(false);
      setRewriteProgress(0);
      setRewrittenCount(0);
      setRewriteFailCount(0);
      setView('scanner');
    }
  }, [user]);

  // --- END CRASH RECOVERY ---
  
  /**
   * Handles syncing with Google Drive.
   * @param silent If true, tries to sync without any popups. If it fails, sets status to error but doesn't crash.
   */
  const handleSyncWithDrive = useCallback(async (silent: boolean = false) => {
    if (!user || !getAccessToken) return;

    setSyncStatus('loading');
    setError(null);
    try {
      // Pass 'silent' flag to getAccessToken
      const token = await getAccessToken(silent);
      const { fileId, cards: loadedCards } = await getCollection(token);
      
      // ** ROBUST DATA SANITIZATION **
      // Filter out completely corrupt entries and ensure required fields exist
      // This prevents the "White Screen" crash if old data is missing images or IDs
      const validCards = loadedCards.filter(c => c && typeof c === 'object').map(card => {
          const safeId = card.id || generateId();
          const safeStatus = card.status || 'reviewed';
          // Ensure images are strings (even if empty)
          const safeFront = card.frontImage || '';
          const safeBack = card.backImage || '';

          return { 
              ...card, 
              id: safeId,
              status: safeStatus as CardData['status'], 
              frontImage: safeFront,
              backImage: safeBack
          };
      });

      setCards(validCards);
      setDriveFileId(fileId);
      setSyncStatus('success');

      if (!silent) {
          alert(`Sync Complete! Found ${validCards.length} cards in your collection.`);
          setView('history'); // Auto-navigate to history so user sees the cards immediately
      }

    } catch (err: any) {
      console.error("Failed to sync with Google Drive", err);
      
      // Handle interaction required specifically
      if (err.message === 'interaction_required') {
          if (silent) {
              // If silent failed, just stop loading
              setSyncStatus('idle'); 
              return;
          }
      }

      const errorMessage = err?.message || (typeof err === 'string' ? err : 'An unknown error occurred during sync.');
      setError(errorMessage);
      setSyncStatus('error');

      // If it's a hard auth error (not just interaction required), sign out to reset state
      if (errorMessage.toLowerCase().includes('permission') || 
          errorMessage.toLowerCase().includes('access token') ||
          errorMessage.toLowerCase().includes('timed out')) {
          // Optional: Auto sign out if the token is completely borked
          // signOut(); 
      }
    }
  }, [user, getAccessToken]);

  const saveCollectionToDrive = useCallback(async (cardsToSave: CardData[]) => {
    // Use silent=true for background saves too
    if (!user || !getAccessToken || syncStatus === 'loading') return;
    
    // Don't clear main error state for background saves to avoid flickering
    try {
      const token = await getAccessToken(true); 
      const newFileId = await saveCollection(token, driveFileId, cardsToSave);
      if (newFileId !== driveFileId) {
        setDriveFileId(newFileId);
      }
      if (syncStatus === 'idle') {
          setSyncStatus('success');
      }
    } catch (err: any) {
      console.error("Failed to save collection to Google Drive", err);
      if (err.message !== 'interaction_required') {
           setError(err.message || "Failed to save your collection. Please check your connection.");
      }
    }
  }, [user, getAccessToken, driveFileId, syncStatus]);
  
  const processCardInBackground = useCallback(async (cardToProcess: CardData) => {
    if (processingCards.current.has(cardToProcess.id)) {
        return; 
    }
    processingCards.current.add(cardToProcess.id);
  
    try {
      let finalCardData: Partial<CardData> = {};
      let finalStatus: CardData['status'] = 'needs_review';

      const frontImageBase64 = dataUrlToBase64(cardToProcess.frontImage);
      const backImageBase64 = dataUrlToBase64(cardToProcess.backImage);

      switch (cardToProcess.status) {
        case 'grading':
          // Stage 1: ID and Preliminary Grade (Numbers Only)
          const identifyPromise = identifyCard(frontImageBase64, backImageBase64);
          const gradePromise = gradeCardPreliminary(frontImageBase64, backImageBase64);
          const [cardIdentification, gradeData] = await Promise.all([identifyPromise, gradePromise]);
          finalCardData = { ...cardIdentification, ...gradeData };
          break;
        
        case 'generating_summary':
          // Stage 2: Generate Summary for accepted card
          const summary = await generateCardSummary(frontImageBase64, backImageBase64, cardToProcess);
          finalCardData = { summary };
          finalStatus = 'reviewed';
          break;

        case 'challenging':
          const challengedResult = await challengeGrade(cardToProcess, cardToProcess.challengeDirection!, () => {});
          finalCardData = { ...challengedResult, challengeDirection: undefined };
          finalStatus = 'needs_review'; // Still needs review after challenge
          break;

        case 'regenerating_summary':
          // This is used for manual edits where we need to rewrite the logic to match the new grade
          const regeneratedData = await regenerateCardAnalysisForGrade(
            frontImageBase64, backImageBase64,
            { name: cardToProcess.name!, team: cardToProcess.team!, set: cardToProcess.set!, edition: cardToProcess.edition!, cardNumber: cardToProcess.cardNumber!, company: cardToProcess.company!, year: cardToProcess.year! },
            cardToProcess.overallGrade!, cardToProcess.gradeName!, () => {}
          );
          finalCardData = regeneratedData;
          finalStatus = 'reviewed'; // Manual grades are accepted automatically
          break;
        
        default:
          processingCards.current.delete(cardToProcess.id);
          return;
      }
      
      setCards(currentCards => {
        const updatedCards = currentCards.map(c => 
          c.id === cardToProcess.id 
            ? { ...c, ...finalCardData, status: finalStatus, isSynced: false } 
            : c
        );
        saveCollectionToDrive(updatedCards);
        return updatedCards;
      });

    } catch (err: any) {
      console.error(`Failed to process card ${cardToProcess.id} with status ${cardToProcess.status}:`, err);
      
      if (err.message === 'API_KEY_MISSING') {
          setIsApiKeyModalOpen(true);
          // Revert status to let user try again after entering key
          setCards(currentCards => currentCards.map(c => c.id === cardToProcess.id ? { ...c, status: 'grading_failed', errorMessage: "Missing API Key" } : c));
      } else {
          setCards(currentCards => {
            const updatedCards = currentCards.map(c => 
              c.id === cardToProcess.id 
                ? { ...c, status: 'grading_failed' as const, errorMessage: err.message || 'Unknown error' } 
                : c
            );
            saveCollectionToDrive(updatedCards);
            return updatedCards;
          });
      }
    } finally {
      processingCards.current.delete(cardToProcess.id);
    }
  }, [saveCollectionToDrive]);

  const handleRatingRequest = useCallback(async (frontImageDataUrl: string, backImageDataUrl: string) => {
    setError(null);
    
    const newCard: CardData = {
      id: generateId(), // Use robust ID generator
      frontImage: frontImageDataUrl,
      backImage: backImageDataUrl,
      timestamp: Date.now(),
      gradingSystem: 'NGA',
      isSynced: false,
      status: 'grading',
    };
    
    setCards(currentCards => {
        const updatedCards = [newCard, ...currentCards];
        saveCollectionToDrive(updatedCards);
        return updatedCards;
    });
  }, [saveCollectionToDrive]);
  
  const handleRetryGrading = useCallback((cardToRetry: CardData) => {
    setCards(currentCards => {
        const updatedCards = currentCards.map(c => 
            c.id === cardToRetry.id 
            ? { ...c, status: 'grading' as const, errorMessage: undefined } 
            : c
        );
        saveCollectionToDrive(updatedCards);
        return updatedCards;
    });
  }, [saveCollectionToDrive]);

  useEffect(() => {
    const cardsInQueue = cards.filter(c => 
        ['grading', 'challenging', 'regenerating_summary', 'generating_summary'].includes(c.status) &&
        !processingCards.current.has(c.id)
    );
    
    const availableSlots = CONCURRENCY_LIMIT - processingCards.current.size;

    if (cardsInQueue.length > 0 && availableSlots > 0) {
        const cardsToStart = cardsInQueue.slice(0, availableSlots);
        cardsToStart.forEach(card => processCardInBackground(card));
    }
  }, [cards, processCardInBackground]);
  
  const handleChallengeExistingCard = useCallback((cardToChallenge: CardData, direction: 'higher' | 'lower') => {
    setCards(currentCards => {
        const updatedCards = currentCards.map(c => 
            c.id === cardToChallenge.id 
            ? { ...c, status: 'challenging' as const, challengeDirection: direction } 
            : c
        );
        saveCollectionToDrive(updatedCards);
        return updatedCards;
    });
  }, [saveCollectionToDrive]);

  const handleAcceptGrade = useCallback(async (cardId: string) => {
      setCards(currentCards => {
          // Transition to 'generating_summary' instead of 'reviewed' immediately
          const updatedCards = currentCards.map(c => c.id === cardId ? { ...c, status: 'generating_summary' as const } : c);
          saveCollectionToDrive(updatedCards);
          return updatedCards;
      });
  }, [saveCollectionToDrive]);
  
  const handleManualGrade = useCallback((cardToUpdate: CardData, newGrade: number, newGradeName: string) => {
      setCards(currentCards => {
        const updatedCards = currentCards.map(c => 
            c.id === cardToUpdate.id 
            ? { ...c, status: 'regenerating_summary' as const, overallGrade: newGrade, gradeName: newGradeName } 
            : c
        );
        saveCollectionToDrive(updatedCards);
        return updatedCards;
      });
  }, [saveCollectionToDrive]);

  const handleRewriteAllAnalyses = useCallback(async () => {
    const cardsToRewrite = cards.filter(c => c.status === 'reviewed');
    if (cardsToRewrite.length === 0) return;

    setIsRewriting(true);
    setRewriteProgress(0);
    setRewrittenCount(0);
    setRewriteFailCount(0);
    setRewriteStatusMessage('');
    setError(null);

    try {
        const CONCURRENCY_LIMIT = 3;
        const updatedCardsResult: CardData[] = [];
        const failedCardsResult: { card: CardData, error: string }[] = [];
        const queue = [...cardsToRewrite];

        const worker = async () => {
            while (queue.length > 0) {
                const card = queue.shift();
                if (!card) continue;

                const cardIndex = cardsToRewrite.findIndex(c => c.id === card.id);
                try {
                    const statusUpdater = (status: string) => setRewriteStatusMessage(`Card #${cardIndex + 1}: ${status}`);
                    const frontImageBase64 = dataUrlToBase64(card.frontImage);
                    const backImageBase64 = dataUrlToBase64(card.backImage);
                    // We need to pass silent=true here if we implemented it in this function, 
                    // but since this function only calls Gemini API, we rely on VITE_API_KEY, not getAccessToken.
                    const regeneratedData = await regenerateCardAnalysisForGrade(
                        frontImageBase64, backImageBase64,
                        { name: card.name!, team: card.team!, set: card.set!, edition: card.edition!, cardNumber: card.cardNumber!, company: card.company!, year: card.year! },
                        card.overallGrade!, card.gradeName!, statusUpdater
                    );
                    const hasChanged = JSON.stringify(regeneratedData.details) !== JSON.stringify(card.details) || regeneratedData.summary !== card.summary;
                    if (hasChanged) {
                        updatedCardsResult.push({ ...card, ...regeneratedData, isSynced: false });
                        setRewrittenCount(prev => prev + 1);
                    }
                } catch (err: any) {
                    if (err.message === 'API_KEY_MISSING') {
                         setIsApiKeyModalOpen(true);
                         // Break queue processing
                         queue.length = 0; 
                         throw err;
                    }
                    failedCardsResult.push({ card, error: err.message || 'Unknown error' });
                    setRewriteFailCount(prev => prev + 1);
                } finally {
                    setRewriteProgress(prev => prev + 1);
                }
            }
        };

        const workers = Array.from({ length: CONCURRENCY_LIMIT }, worker);
        await Promise.all(workers);

        if (updatedCardsResult.length > 0) {
            setCards(currentCards => {
                const updatedCardsMap = new Map(updatedCardsResult.map(c => [c.id, c]));
                const finalCards = currentCards.map(originalCard => updatedCardsMap.get(originalCard.id) || originalCard);
                saveCollectionToDrive(finalCards);
                return finalCards;
            });
        }
    } catch (e: any) {
        if (e.message !== 'API_KEY_MISSING') {
             setError("An unexpected error occurred during the rewrite process.");
        }
    } finally {
        setIsRewriting(false);
    }
  }, [cards, saveCollectionToDrive]);

  const handleCardsSynced = (syncedCards: CardData[]) => {
    const syncedIds = new Set(syncedCards.map(c => c.id));
    setCards(currentCards => {
        const updatedCards = currentCards.map(card => 
            syncedIds.has(card.id) ? { ...card, isSynced: true } : card
        );
        saveCollectionToDrive(updatedCards);
        return updatedCards;
    });
  };

  const handleResyncCard = useCallback(async (cardToResync: CardData) => {
      if (!user || !getAccessToken) return;
      setError(null);
      try {
          const token = await getAccessToken(false); // Interactive
          const sheetUrl = localStorage.getItem('google_sheet_url');
          if (!sheetUrl) {
              setError("No Google Sheet URL found. Please perform a bulk sync first to configure it.");
              return;
          }
          await syncToSheet(token, sheetUrl, [cardToResync]);
      } catch (err: any) {
          setError(err.message || `Failed to resync ${cardToResync.name}.`);
      }
  }, [user, getAccessToken]);

  const handleDeleteCard = useCallback((cardIdToDelete: string) => {
    setCards(currentCards => {
        const newCards = currentCards.filter(card => card.id !== cardIdToDelete);
        saveCollectionToDrive(newCards);
        return newCards;
    });
  }, [saveCollectionToDrive]);

  const resetRewriteState = useCallback(() => {
    setIsRewriting(false);
    setRewriteProgress(0);
    setRewrittenCount(0);
    setRewriteFailCount(0);
    setRewriteStatusMessage('');
  }, []);

  const renderView = () => {
    switch (view) {
      case 'history':
        return <CardHistory 
                  cards={cards} 
                  onBack={() => setView('scanner')} 
                  onDelete={handleDeleteCard} 
                  getAccessToken={() => getAccessToken(false)} 
                  onCardsSynced={handleCardsSynced}
                  onChallengeGrade={handleChallengeExistingCard}
                  onResync={handleResyncCard}
                  onRetryGrading={handleRetryGrading}
                  onRewriteAllAnalyses={handleRewriteAllAnalyses}
                  resetRewriteState={resetRewriteState}
                  isRewriting={isRewriting}
                  rewriteProgress={rewriteProgress}
                  rewrittenCount={rewrittenCount}
                  rewriteFailCount={rewriteFailCount}
                  rewriteStatusMessage={rewriteStatusMessage}
                  onAcceptGrade={handleAcceptGrade}
                  onManualGrade={handleManualGrade}
                  onLoadCollection={() => handleSyncWithDrive(false)} // Manual load prop
                />;
      case 'scanner':
      default:
        return <CardScanner 
                  onRatingRequest={handleRatingRequest} 
                  isGrading={isGrading} 
                  gradingStatus={gradingStatus}
                />;
    }
  };

  const renderHeaderControls = () => {
    if (!user) return null;
    
    const needsReviewCount = cards.filter(c => c.status === 'needs_review').length;
    const hasCollectionLoaded = !!driveFileId || cards.length > 0;
    
    return (
      <div className="flex items-center gap-2">
         {/* Manual Key Entry Button */}
        <button
            onClick={() => setIsApiKeyModalOpen(true)}
            className="p-2 text-slate-500 hover:text-blue-600 rounded-full hover:bg-slate-100 transition-colors"
            title="Set API Key Manually"
        >
            <KeyIcon className="w-5 h-5" />
        </button>

        {/* Load Collection Button - Visible if logged in but not synced */}
        {!hasCollectionLoaded && (
          <button 
              onClick={() => handleSyncWithDrive(false)}
              disabled={syncStatus === 'loading'}
              className="flex items-center gap-2 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-md transition disabled:opacity-50"
          >
              {syncStatus === 'loading' ? <SpinnerIcon className="w-4 h-4" /> : <ResyncIcon className="w-4 h-4" />}
              <span className="hidden sm:inline">Load Drive</span>
          </button>
        )}

        {/* Navigation Button */}
        <button 
          onClick={() => setView(view === 'history' ? 'scanner' : 'history')} 
          className="relative flex items-center gap-2 py-2 px-4 bg-white/70 hover:bg-white text-slate-800 font-semibold rounded-lg shadow-md transition border border-slate-300"
        >
          <HistoryIcon className="h-5 w-5" />
          <span className="hidden sm:inline">{view === 'history' ? 'Scanner' : `Collection (${cards.length})`}</span>
          {needsReviewCount > 0 && view !== 'history' && (
            <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
              {needsReviewCount}
            </span>
          )}
        </button>
        
        {/* Explicit Sign Out Button for safety */}
        <button onClick={signOut} className="hidden md:block text-sm font-semibold text-slate-500 hover:text-red-600 px-2">
            Sign Out
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen font-sans flex flex-col items-center p-4">
        <header className="w-full max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center p-4 gap-4">
            <img src="https://mcusercontent.com/d7331d7f90c4b088699bd7282/images/98cb8f09-7621-798a-803a-26d394c7b10f.png" alt="MARC AI Grader Logo" className="h-10 w-auto" />
            <div className="flex items-center gap-4">
              {renderHeaderControls()}
              <Auth user={user} onSignOut={signOut} isAuthReady={isAuthReady} />
            </div>
        </header>
        <main className="w-full flex-grow flex flex-col justify-center items-center">
            {error && (
                <div className="w-full max-w-md bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-4 shadow-md" role="alert">
                    <strong className="font-bold">Error: </strong>
                    <span className="block sm:inline">{error}</span>
                    {/* Add a manual Retry/Sign out link in error box if auth failed */}
                    {(error.includes('permission') || error.includes('timed out')) && (
                        <div className="mt-2">
                             <button onClick={signOut} className="underline font-bold hover:text-red-900">Click here to Sign Out and Reset</button>
                        </div>
                    )}
                    <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setError(null)}>
                        <svg className="fill-current h-6 w-6 text-red-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
                    </span>
                </div>
            )}
            {renderView()}
            {isApiKeyModalOpen && (
              <ApiKeyModal 
                onSave={(key) => {
                    saveManualApiKey(key);
                    setIsApiKeyModalOpen(false);
                    // Retry mechanism: User will likely have to click "Add to Queue" again or delete/retry failed card
                    alert("Key saved! Please try grading the card again.");
                }}
                onClose={() => setIsApiKeyModalOpen(false)}
              />
            )}
        </main>
    </div>
  );
};

export default App;
