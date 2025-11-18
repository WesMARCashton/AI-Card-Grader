
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
  gradeAndSummarizeCard,
} from './services/geminiService';
import { getCollection, saveCollection } from './services/driveService';
import { syncToSheet } from './services/sheetsService';
import { HistoryIcon, ResyncIcon } from './components/icons';
import { dataUrlToBase64 } from './utils/fileUtils';

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';

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
  
  // Ref to track which cards are currently being processed to prevent duplicates
  const processingCards = useRef(new Set<string>());
  const CONCURRENCY_LIMIT = 2; // Process up to 2 cards at a time to avoid rate limits
  
  // Reset local state when the user signs out.
  useEffect(() => {
    if (!user) {
      setCards([]);
      setDriveFileId(null);
      setSyncStatus('idle');
      setError(null);
      setIsRewriting(false);
      setRewriteProgress(0);
      setRewrittenCount(0);
      setRewriteFailCount(0);
      setView('scanner'); // Go back to scanner on sign out
    }
  }, [user]);
  
  const handleSyncWithDrive = useCallback(async () => {
    if (!user || !getAccessToken) return;

    setSyncStatus('loading');
    setError(null);
    try {
      const token = await getAccessToken();
      const { fileId, cards: loadedCards } = await getCollection(token);
      
      // ** DATA MIGRATION STEP **
      // This ensures that cards saved before the 'status' field was added
      // are correctly handled and displayed in the collection.
      const migratedCards = loadedCards.map(card => {
          if (!card.status) {
              return { ...card, status: 'reviewed' as const };
          }
          return card;
      });

      setCards(migratedCards);
      setDriveFileId(fileId);
      setSyncStatus('success');
      // Only switch view if we have cards, otherwise stay on scanner
      if (migratedCards.length > 0) {
        // Optional: automatically switch to history. 
        // Removed to prevent jarring UX if user just wants to scan.
      }
    } catch (err: any) {
      console.error("Failed to sync with Google Drive", err);
      const errorMessage = err?.message || (typeof err === 'string' ? err : 'An unknown error occurred during sync.');
      setError(errorMessage);
      setSyncStatus('error');
    }
  }, [user, getAccessToken]);

  // Auto-sync on initial load when user is ready
  useEffect(() => {
    if (user && isAuthReady && syncStatus === 'idle') {
      handleSyncWithDrive();
    }
  }, [user, isAuthReady, syncStatus, handleSyncWithDrive]);

  const saveCollectionToDrive = useCallback(async (cardsToSave: CardData[]) => {
    if (!user || !getAccessToken || syncStatus === 'loading') return;
    setError(null);
    try {
      const token = await getAccessToken();
      const newFileId = await saveCollection(token, driveFileId, cardsToSave);
      if (newFileId !== driveFileId) {
        setDriveFileId(newFileId);
      }
      // If sync was previously idle (e.g., first save), mark as success.
      if (syncStatus === 'idle') {
          setSyncStatus('success');
      }
    } catch (err: any) {
      console.error("Failed to save collection to Google Drive", err);
      setError(err.message || "Failed to save your collection. Please check your connection.");
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
          const identifyPromise = identifyCard(frontImageBase64, backImageBase64);
          const gradePromise = gradeAndSummarizeCard(frontImageBase64, backImageBase64);
          const [cardIdentification, gradeData] = await Promise.all([identifyPromise, gradePromise]);
          finalCardData = { ...cardIdentification, ...gradeData };
          break;

        case 'challenging':
          const challengedResult = await challengeGrade(cardToProcess, cardToProcess.challengeDirection!, () => {});
          finalCardData = { ...challengedResult, challengeDirection: undefined };
          break;

        case 'regenerating_summary':
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
      setCards(currentCards => {
        const updatedCards = currentCards.map(c => 
          c.id === cardToProcess.id 
            ? { ...c, status: 'grading_failed' as const, errorMessage: err.message || 'Unknown error' } 
            : c
        );
        saveCollectionToDrive(updatedCards);
        return updatedCards;
      });
    } finally {
      processingCards.current.delete(cardToProcess.id);
    }
  }, [saveCollectionToDrive]);

  const handleRatingRequest = useCallback(async (frontImageDataUrl: string, backImageDataUrl: string) => {
    setError(null);
    
    const newCard: CardData = {
      id: crypto.randomUUID(),
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

  // This effect acts as a queue manager, processing cards up to the concurrency limit.
  useEffect(() => {
    // Find cards that need processing and are not already in flight
    const cardsInQueue = cards.filter(c => 
        ['grading', 'challenging', 'regenerating_summary'].includes(c.status) &&
        !processingCards.current.has(c.id)
    );
    
    const availableSlots = CONCURRENCY_LIMIT - processingCards.current.size;

    if (cardsInQueue.length > 0 && availableSlots > 0) {
        // We can process more cards. Take the next ones from the queue.
        const cardsToStart = cardsInQueue.slice(0, availableSlots);
        cardsToStart.forEach(card => processCardInBackground(card));
    }
  }, [cards, processCardInBackground]); // This effect re-evaluates whenever the cards list changes
  
  const handleChallengeExistingCard = useCallback((cardToChallenge: CardData, direction: 'higher' | 'lower') => {
    setCards(currentCards => {
        const updatedCards = currentCards.map(c => 
            c.id === cardToChallenge.id 
            // FIX: Use 'as const' to ensure TypeScript infers the correct literal type for status.
            ? { ...c, status: 'challenging' as const, challengeDirection: direction } 
            : c
        );
        saveCollectionToDrive(updatedCards);
        return updatedCards;
    });
  }, [saveCollectionToDrive]);

  const handleAcceptGrade = useCallback(async (cardId: string) => {
      setCards(currentCards => {
          // FIX: Use 'as const' to ensure TypeScript infers the correct literal type for status.
          const updatedCards = currentCards.map(c => c.id === cardId ? { ...c, status: 'reviewed' as const } : c);
          saveCollectionToDrive(updatedCards);
          return updatedCards;
      });
  }, [saveCollectionToDrive]);
  
  const handleManualGrade = useCallback((cardToUpdate: CardData, newGrade: number, newGradeName: string) => {
      setCards(currentCards => {
        const updatedCards = currentCards.map(c => 
            c.id === cardToUpdate.id 
            // FIX: Use 'as const' to ensure TypeScript infers the correct literal type for status.
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
    } catch (e) {
        setError("An unexpected error occurred during the rewrite process setup.");
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
          const token = await getAccessToken();
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
                  getAccessToken={getAccessToken} 
                  onCardsSynced={handleCardsSynced}
                  onChallengeGrade={handleChallengeExistingCard}
                  onResync={handleResyncCard}
                  onRewriteAllAnalyses={handleRewriteAllAnalyses}
                  resetRewriteState={resetRewriteState}
                  isRewriting={isRewriting}
                  rewriteProgress={rewriteProgress}
                  rewrittenCount={rewrittenCount}
                  rewriteFailCount={rewriteFailCount}
                  rewriteStatusMessage={rewriteStatusMessage}
                  onAcceptGrade={handleAcceptGrade}
                  onManualGrade={handleManualGrade}
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
    
    // We display the button even if loading, but maybe with a different state
    if (syncStatus === 'loading') {
      return <button disabled className="py-2 px-4 bg-slate-500 text-white font-semibold rounded-lg shadow-md animate-pulse">Syncing...</button>;
    }
    
    if (syncStatus === 'error') {
      return (
        <button onClick={handleSyncWithDrive} className="flex items-center gap-2 py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-md transition">
          <ResyncIcon className="w-5 h-5" />
          <span>Retry Sync</span>
        </button>
      );
    }
    
    // Default state (idle or success) - allows user to toggle views
    const needsReviewCount = cards.filter(c => c.status === 'needs_review').length;
    
    // If we have cards, show the count. If we have 0 cards but synced successfully, show "My Collection".
    // This ensures the button is always available if they want to check the empty state or if sync happened but returned 0.
    return (
      <button 
        onClick={() => setView(view === 'history' ? 'scanner' : 'history')} 
        className="relative flex items-center gap-2 py-2 px-4 bg-white/70 hover:bg-white text-slate-800 font-semibold rounded-lg shadow-md transition border border-slate-300"
      >
        <HistoryIcon className="h-5 w-5" />
        <span>{view === 'history' ? 'Back to Scanner' : `My Collection (${cards.length})`}</span>
        {needsReviewCount > 0 && view !== 'history' && (
          <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
            {needsReviewCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen font-sans flex flex-col items-center p-4">
        <header className="w-full max-w-4xl mx-auto flex justify-between items-center p-4">
            <img src="https://mcusercontent.com/d7331d7f90c4b088699bd7282/images/98cb8f09-7621-798a-803a-26d394c7b10f.png" alt="MARC AI Grader Logo" className="h-10 w-auto" />
            <div className="flex items-center gap-4">
              {renderHeaderControls()}
              <Auth user={user} onSignOut={signOut} isAuthReady={isAuthReady} />
            </div>
        </header>
        <main className="w-full flex-grow flex flex-col justify-center items-center">
            {error && (
                <div className="w-full max-w-md bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-4" role="alert">
                    <strong className="font-bold">Error: </strong>
                    <span className="block sm:inline">{error}</span>
                    <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setError(null)}>
                        <svg className="fill-current h-6 w-6 text-red-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
                    </span>
                </div>
            )}
            {renderView()}
        </main>
    </div>
  );
};

export default App;
