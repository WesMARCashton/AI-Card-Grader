import { GoogleGenAI, GenerateContentResponse, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { CardData, EvaluationDetails, MarketValue } from "../types";
import { dataUrlToBase64 } from "../utils/fileUtils";

const MANUAL_API_KEY_STORAGE = 'manual_gemini_api_key';

const extractJson = (response: GenerateContentResponse): any => {
    const text = response.text;
    if (!text || text.trim().length === 0) {
        const reason = response.candidates?.[0]?.finishReason;
        throw new Error(`AI returned an empty response (Reason: ${reason || 'Unknown'}). Content may be flagged or model is overloaded.`);
    }

    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = text.match(jsonRegex);
    const jsonString = (match && match[1]) ? match[1] : text;

    try {
        return JSON.parse(jsonString.trim());
    } catch (e) {
        console.error("Failed to parse JSON from AI response:", text);
        throw new Error("AI response was not in a valid format. Please try again.");
    }
}

const handleGeminiError = (error: any, context: string): Error => {
    console.error(`Error in ${context}:`, error);
    let msg = error.message || "An unexpected error occurred.";

    if (msg.includes('model is overloaded') || msg.includes('busy')) {
        return new Error("The AI model is currently busy. Please wait a moment and retry.");
    }
    if (msg.includes('api key') || msg.includes('401') || msg === 'API_KEY_MISSING') {
        return new Error("API_KEY_MISSING");
    }
    return new Error(msg);
};

const withRetry = async <T>(
  apiCall: () => Promise<T>,
  context: string,
  onRetry?: (attempt: number, delay: number) => void,
  retries = 3,
  initialDelay = 2000
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await apiCall();
    } catch (error: any) {
      lastError = error;
      const msg = error.message?.toLowerCase() || '';
      const isRetryable = msg.includes('overloaded') || msg.includes('busy') || msg.includes('503') || msg.includes('empty response');

      if (isRetryable && i < retries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        onRetry?.(i + 1, delay);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw handleGeminiError(error, context);
      }
    }
  }
  throw handleGeminiError(lastError, context);
};

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const NGA_GRADING_STANDARDS = `
--- START OF NGA GRADING STANDARDS ---
**STRICT PROFESSIONAL GRADING ONLY**
You are a cynical, master-level sports card grader. Your goal is to find reasons to LOWER the grade. 

**Evaluation Categories (Subgrades)**
- **Centering (25%):** Alignment of borders. 10=50/50. 9=60/40. 8=65/35. 7=70/30 or worse.
- **Corners (25%):** Physical integrity. 10=Razor sharp. 9.5=Hint of white under high magnification. 9=Soft corner visible. 8=Rounded corners. 7=Corner dent/crease.
- **Edges (20%):** Smoothness of the cut. 10=Zero nicks. 9=Minor silvering/chipping. 8=Visible rough cut or multiple nicks.
- **Surface (20%):** Perfection of printing and finish. 10=Flawless. 9.5=One micro-line. 9=Visible scratch, smudge, or print lines. 8=Staining, pitting, or multiple scratches.
- **Print Quality (10%):** Clarity and Registration.

**LOGIC RULES:**
- If Average ends in .25, round DOWN to the nearest .0.
- If Average ends in .75, round DOWN to the nearest .5.
- **CREASE PENALTY:** Any crease = MAX OVERALL 5.0.
- **LOW QUALITY PENALTY:** If any subgrade is < 6.0, overall grade is capped at 6.0.

**INSTRUCTION:** Every card is unique. Describe SPECIFIC visible imperfections for THIS card only. Never use generic template responses. Awarding a 10 should be near-impossible. Look for whitening on the back corners and edge chipping.
--- END OF NGA GRADING STANDARDS ---
`;

const getAIClient = () => {
  // Hard sync from localStorage to process.env for this specific execution context
  const storedKey = localStorage.getItem(MANUAL_API_KEY_STORAGE);
  if (storedKey) {
    if (!(window as any).process) (window as any).process = { env: {} };
    (process.env as any).API_KEY = storedKey;
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
      throw new Error("API_KEY_MISSING");
  }
  return new GoogleGenAI({ apiKey });
};

export const identifyCard = async (frontImageBase64: string, backImageBase64: string): Promise<any> => {
    const ai = getAIClient();
    const prompt = `Identify this sports card exactly. Strictly output valid JSON only: { "name": string, "team": string, "year": string, "set": string, "company": string, "cardNumber": string, "edition": string }`;
    
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        team: { type: Type.STRING },
        set: { type: Type.STRING },
        edition: { type: Type.STRING },
        cardNumber: { type: Type.STRING },
        company: { type: Type.STRING },
        year: { type: Type.STRING },
      },
      required: ['name', 'team', 'year', 'set', 'company', 'cardNumber', 'edition']
    };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { 
              safetySettings,
              temperature: 0.1, 
              responseMimeType: "application/json", 
              responseSchema 
            }
        }),
        'identifying card'
    );
    return extractJson(response);
};

export const gradeCardPreliminary = async (frontImageBase64: string, backImageBase64: string): Promise<{ details: EvaluationDetails, overallGrade: number, gradeName: string }> => {
    const ai = getAIClient();
    // Unique salt to prevent deterministic identical output
    const sessionSalt = Math.random().toString(36).substring(7);
    const prompt = `[Request ID: ${sessionSalt}] Perform a cynical, highly critical NGA analysis. ${NGA_GRADING_STANDARDS} Examine the high-resolution images for unique whitening, centering issues, and surface scratches specific to THIS card. Output valid JSON only.`;

    const subGradeSchema = {
      type: Type.OBJECT,
      properties: { grade: { type: Type.NUMBER }, notes: { type: Type.STRING } },
      required: ['grade', 'notes'],
    };
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        details: {
          type: Type.OBJECT,
          properties: {
            centering: subGradeSchema,
            corners: subGradeSchema,
            edges: subGradeSchema,
            surface: subGradeSchema,
            printQuality: subGradeSchema,
          },
          required: ['centering', 'corners', 'edges', 'surface', 'printQuality'],
        },
        overallGrade: { type: Type.NUMBER },
        gradeName: { type: Type.STRING },
      },
      required: ['details', 'overallGrade', 'gradeName'],
    };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-pro-preview', 
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { 
              safetySettings,
              temperature: 0.15, // Slight increase for descriptive variety
              responseMimeType: "application/json", 
              responseSchema 
            }
        }),
        'grading card'
    );
    return extractJson(response);
};

export const generateCardSummary = async (frontImageBase64: string, backImageBase64: string, cardData: Partial<CardData>): Promise<string> => {
    const ai = getAIClient();
    const prompt = `Write a professional 2-3 sentence report on why this card is a ${cardData.overallGrade}. Use subgrades: ${JSON.stringify(cardData.details)}. Mention SPECIFIC flaws seen in THESE images. JSON: { "summary": string }`;
    const responseSchema = { type: Type.OBJECT, properties: { summary: { type: Type.STRING } }, required: ['summary'] };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { 
              safetySettings,
              temperature: 0.7, 
              responseMimeType: "application/json", 
              responseSchema 
            }
        }),
        'summary'
    );
    return extractJson(response).summary;
};

export const challengeGrade = async (card: CardData, direction: 'higher' | 'lower', onStatusUpdate: (status: string) => void): Promise<{ details: EvaluationDetails, summary: string, overallGrade: number, gradeName: string }> => {
    const ai = getAIClient();
    const prompt = `User challenges the grade of ${card.overallGrade} as too ${direction}. Re-evaluate specifically looking for evidence supporting a ${direction} grade. Use ${NGA_GRADING_STANDARDS}. JSON output only.`;
    const subGradeSchema = { type: Type.OBJECT, properties: { grade: { type: Type.NUMBER }, notes: { type: Type.STRING } }, required: ['grade', 'notes'] };
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        overallGrade: { type: Type.NUMBER },
        gradeName: { type: Type.STRING },
        details: {
          type: Type.OBJECT,
          properties: { centering: subGradeSchema, corners: subGradeSchema, edges: subGradeSchema, surface: subGradeSchema, printQuality: subGradeSchema },
          required: ['centering', 'corners', 'edges', 'surface', 'printQuality'],
        },
        summary: { type: Type.STRING },
      },
      required: ['overallGrade', 'gradeName', 'details', 'summary'],
    };

    const frontImageBase64 = dataUrlToBase64(card.frontImage);
    const backImageBase64 = dataUrlToBase64(card.backImage);
    
    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { 
              safetySettings,
              temperature: 0.2,
              responseMimeType: "application/json", 
              responseSchema 
            }
        }), 
        'challenge'
    );
    return extractJson(response);
};

export const regenerateCardAnalysisForGrade = async (frontImageBase64: string, backImageBase64: string, cardInfo: any, targetGrade: number, targetGradeName: string, onStatusUpdate: (status: string) => void): Promise<{ details: EvaluationDetails, summary: string }> => {
    const ai = getAIClient();
    const prompt = `Justify a manual grade of ${targetGrade} (${targetGradeName}) using NGA rules. Highlight SPECIFIC visual evidence in these images that support this exact grade. JSON output only.`;
    const subGradeSchema = { type: Type.OBJECT, properties: { grade: { type: Type.NUMBER }, notes: { type: Type.STRING } }, required: ['grade', 'notes'] };
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        details: {
          type: Type.OBJECT,
          properties: { centering: subGradeSchema, corners: subGradeSchema, edges: subGradeSchema, surface: subGradeSchema, printQuality: subGradeSchema },
          required: ['centering', 'corners', 'edges', 'surface', 'printQuality'],
        },
        summary: { type: Type.STRING },
      },
      required: ['details', 'summary'],
    };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { 
              safetySettings,
              temperature: 0.3,
              responseMimeType: "application/json", 
              responseSchema 
            }
        }), 
        'regenerate'
    );
    return extractJson(response);
};

export const getCardMarketValue = async (card: CardData): Promise<MarketValue> => {
    const ai = getAIClient();
    const query = `${card.year} ${card.company} ${card.set} ${card.name} #${card.cardNumber} Grade ${card.overallGrade}`;
    const prompt = `Find real-world recent sold listings for: "${query}". Return the current fair market value range. JSON: { "averagePrice": number, "minPrice": number, "maxPrice": number, "currency": string, "notes": string }.`;

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [{ text: prompt }] },
            config: { 
              safetySettings,
              tools: [{ googleSearch: {} }], 
              temperature: 0.1 
            }
        }),
        'market value'
    );

    const data = extractJson(response);
    const sourceUrls: any[] = [];
    response.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((c: any) => {
        if (c.web?.uri) sourceUrls.push({ title: c.web.title || 'Source', uri: c.web.uri });
    });

    return {
        averagePrice: data.averagePrice || 0,
        minPrice: data.minPrice || 0,
        maxPrice: data.maxPrice || 0,
        currency: data.currency || 'USD',
        notes: data.notes || '',
        sourceUrls
    };
};
