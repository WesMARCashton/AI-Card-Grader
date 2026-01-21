
declare global {
  // Define AIStudio interface as required by the environment's window augmentation
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    env: {
      VITE_API_KEY: string;
    };
    // Fix: Made aistudio optional to ensure identical modifiers across declarations (Line 15)
    aistudio?: AIStudio;
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
  picture: string;
}

export interface SubGradeDetail {
  grade: number;
  notes: string;
}

export interface EvaluationDetails {
  centering: SubGradeDetail;
  corners: SubGradeDetail;
  edges: SubGradeDetail;
  surface: SubGradeDetail;
  printQuality: SubGradeDetail;
}

export interface MarketValue {
    averagePrice: number;
    minPrice: number;
    maxPrice: number;
    currency: string;
    lastSoldDate?: string;
    sourceUrls: { title: string; uri: string }[];
    notes?: string;
}

export type CardStatus = 'grading' | 'needs_review' | 'reviewed' | 'grading_failed' | 'challenging' | 'regenerating_summary' | 'generating_summary' | 'fetching_value';

export interface CardData {
  id:string;
  status: CardStatus;
  
  // Card Overview
  name?: string;
  team?: string;
  set?: string;
  edition?: string; // e.g., 'Base', 'Chrome', 'Refractor'
  cardNumber?: string;
  company?: string;
  year?: string;
  
  frontImage: string;
  backImage: string;
  
  overallGrade?: number;
  gradeName?: string; // e.g., "Mint", "Gem Mint"
  
  details?: EvaluationDetails;
  summary?: string;
  
  marketValue?: MarketValue; // Added market value field
  
  timestamp: number;
  gradingSystem: 'NGA';
  isSynced?: boolean;

  errorMessage?: string;
  challengeDirection?: 'higher' | 'lower';
}

export type AppView = 'scanner' | 'history';
