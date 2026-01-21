
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { CardData, EvaluationDetails, MarketValue } from "../types";
import { dataUrlToBase64 } from "../utils/fileUtils";

const extractJson = (response: GenerateContentResponse): any => {
    const text = response.text;
    if (!text) {
        const reason = response.candidates?.[0]?.finishReason;
        throw new Error(`AI returned an empty response. (Reason: ${reason || 'Unknown'}). This usually happens if the content is flagged or the model is overloaded.`);
    }

    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = text.match(jsonRegex);
    const jsonString = (match && match[1]) ? match[1] : text;

    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Failed to parse JSON from AI response:", text);
        throw new Error("AI response was not in a valid format. Please try again.");
    }
}

const handleGeminiError = (error: any, context: string): Error => {
    console.error(`Error in ${context}:`, error);
    let msg = error.message || "An unexpected error occurred.";

    if (msg.includes('model is overloaded') || msg.includes('busy')) {
        return new Error("The AI model is currently busy. We are retrying, but if this persists, please try again in a few minutes.");
    }
    if (msg.includes('api key') || msg.includes('401')) {
        return new Error("API_KEY_MISSING");
    }
    return new Error(msg);
};

const withRetry = async <T>(
  apiCall: () => Promise<T>,
  context: string,
  onRetry?: (attempt: number, delay: number) => void,
  retries = 15,
  initialDelay = 4000
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await apiCall();
    } catch (error: any) {
      lastError = error;
      const msg = error.message?.toLowerCase() || '';
      const isRetryable = msg.includes('overloaded') || msg.includes('busy') || msg.includes('unavailable') || msg.includes('503') || msg.includes('504') || msg.includes('empty response');

      if (isRetryable && i < retries - 1) {
        const delay = Math.min(initialDelay * Math.pow(1.6, i) + Math.random() * 2000, 45000);
        onRetry?.(i + 1, delay);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw handleGeminiError(error, context);
      }
    }
  }
  throw handleGeminiError(lastError, context);
};

const NGA_GRADING_GUIDE = `
--- NGA GRADING GUIDE ---
- Centering (25%): 10=Perfect, 9=60/40.
- Corners (25%): 10=Razor sharp, 9=One slightly soft.
- Edges (20%): 10=Perfect, 9.5=One microscopic speck.
- Surface (20%): 10=Flawless, 9.5=One tiny line.
- Print Quality (10%): 10=Sharp focus.
Final Grade: Average categories, round to nearest 0.5. Cap at 5 if creased. Cap at 6 if surface/corners < 6.
`;

const getAIClient = () => {
  const apiKey = localStorage.getItem('nga_manual_api_key') || process.env.API_KEY || '';
  return new GoogleGenAI({ apiKey });
};

export const identifyCard = async (frontImageBase64: string, backImageBase64: string): Promise<CardIdentification> => {
    const ai = getAIClient();
    const prompt = `Strictly output JSON only for this sports card identification: { "name": string, "team": string, "year": string, "set": string, "company": string, "cardNumber": string, "edition": string }. Do not include explanations.`;
    
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
            model: 'gemini-3-flash-preview', 
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { temperature: 0.1, responseMimeType: "application/json", responseSchema }
        }),
        'identifying card'
    );
    return extractJson(response);
};

export const gradeCardPreliminary = async (frontImageBase64: string, backImageBase64: string): Promise<{ details: EvaluationDetails, overallGrade: number, gradeName: string }> => {
    const ai = getAIClient();
    const prompt = `Strictly perform NGA grading analysis and output JSON only. ${NGA_GRADING_GUIDE}`;

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
            model: 'gemini-3-flash-preview', 
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { temperature: 0.0, responseMimeType: "application/json", responseSchema }
        }),
        'grading card'
    );
    return extractJson(response);
};

export const generateCardSummary = async (frontImageBase64: string, backImageBase64: string, cardData: Partial<CardData>): Promise<string> => {
    const ai = getAIClient();
    const prompt = `Output JSON only with a "summary" field (2-3 sentences) explaining the grade for: ${cardData.year} ${cardData.name} #${cardData.cardNumber}. Grade: ${cardData.overallGrade}. Subgrades: ${JSON.stringify(cardData.details)}`;
    const responseSchema = { type: Type.OBJECT, properties: { summary: { type: Type.STRING } }, required: ['summary'] };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { temperature: 0.7, responseMimeType: "application/json", responseSchema }
        }),
        'summary'
    );
    return extractJson(response).summary;
};

export const challengeGrade = async (card: CardData, direction: 'higher' | 'lower', onStatusUpdate: (status: string) => void): Promise<{ details: EvaluationDetails, summary: string, overallGrade: number, gradeName: string }> => {
    const ai = getAIClient();
    const prompt = `Re-evaluate card as ${direction} strictly following NGA Guide. Output JSON only. Current: ${JSON.stringify(card.details)}`;
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
            model: 'gemini-3-flash-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { responseMimeType: "application/json", responseSchema }
        }), 
        'challenge'
    );
    return extractJson(response);
};

export const regenerateCardAnalysisForGrade = async (frontImageBase64: string, backImageBase64: string, cardInfo: any, targetGrade: number, targetGradeName: string, onStatusUpdate: (status: string) => void): Promise<{ details: EvaluationDetails, summary: string }> => {
    const ai = getAIClient();
    const prompt = `Justify grade of ${targetGrade} (${targetGradeName}) with subgrades and summary. Output JSON only.`;
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
            model: 'gemini-3-flash-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { responseMimeType: "application/json", responseSchema }
        }), 
        'regenerate'
    );
    return extractJson(response);
};

export const getCardMarketValue = async (card: CardData): Promise<MarketValue> => {
    const ai = getAIClient();
    const query = `${card.year} ${card.company} ${card.set} ${card.name} #${card.cardNumber} Grade ${card.overallGrade}`;
    const prompt = `Find recent sold prices for: "${query}". Output JSON only: { "averagePrice": number, "minPrice": number, "maxPrice": number, "currency": string }.`;

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [{ text: prompt }] },
            config: { tools: [{ googleSearch: {} }], temperature: 0.1 }
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
        sourceUrls
    };
};

export interface CardIdentification {
    name: string;
    team: string;
    set: string;
    edition: string;
    cardNumber: string;
    company: string;
    year: string;
}
