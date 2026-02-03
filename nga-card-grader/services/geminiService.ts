
import { GoogleGenAI, GenerateContentResponse, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { CardData, EvaluationDetails, MarketValue } from "../types";
import { dataUrlToBase64 } from "../utils/fileUtils";

const MANUAL_API_KEY_STORAGE = 'manual_gemini_api_key';

const extractJson = (response: GenerateContentResponse): any => {
    const text = response.text;
    if (!text || text.trim().length === 0) {
        const reason = response.candidates?.[0]?.finishReason;
        throw new Error(`AI returned an empty response (Reason: ${reason || 'Unknown'}). This usually happens with blurry photos or connection issues. Please try again.`);
    }

    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = text.match(jsonRegex);
    const jsonString = (match && match[1]) ? match[1] : text;

    try {
        return JSON.parse(jsonString.trim());
    } catch (e) {
        console.error("Failed to parse JSON from AI response:", text);
        throw new Error("AI response format error. Please try again.");
    }
}

const handleGeminiError = (error: any, context: string): Error => {
    console.error(`Error in ${context}:`, error);
    let msg = error.message || "An unexpected error occurred.";

    if (msg.includes('model is overloaded') || msg.includes('busy')) {
        return new Error("The AI model is currently busy. Retrying...");
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
  retries = 2,
  initialDelay = 1500
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
        const delay = initialDelay * Math.pow(1.5, i);
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

const NGA_SYSTEM_INSTRUCTION = `You are a professional, strict sports card grader operating under NGA standards. 
Your goal is to identify the card and provide a detailed condition report. 
BE CYNICAL: Find flaws. Awarding a 10 is almost impossible. 
RULES:
1. Centering (25%): 10=50/50, 9=60/40, 8=65/35, 7=70/30.
2. Corners (25%): 10=Sharp, 9.5=Micro-white, 9=Soft, 8=Rounded, 7=Dent/Crease.
3. Edges (20%): 10=Zero nicks, 9=Minor silvering, 8=Visible rough cut.
4. Surface (20%): 10=Flawless, 9=Scratch/Smudge, 8=Pitting/Stain.
5. Print Quality (10%): Clarity.
LOGIC:
- Crease = MAX 5.0 Overall.
- Subgrade < 6.0 = MAX 6.0 Overall.
- Average .25 or .75? Round DOWN to nearest .0 or .5.
ALWAYS output valid JSON.`;

const getAIClient = () => {
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

export const analyzeCardFull = async (frontImageBase64: string, backImageBase64: string): Promise<any> => {
    const ai = getAIClient();
    const prompt = `Identify this sports card and perform a strict NGA analysis. Output JSON with fields: name, team, year, set, company, cardNumber, edition, details (centering, corners, edges, surface, printQuality: {grade, notes}), overallGrade, gradeName, summary.`;
    
    const subGradeSchema = {
      type: Type.OBJECT,
      properties: { grade: { type: Type.NUMBER }, notes: { type: Type.STRING } },
      required: ['grade', 'notes'],
    };

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        team: { type: Type.STRING },
        year: { type: Type.STRING },
        set: { type: Type.STRING },
        company: { type: Type.STRING },
        cardNumber: { type: Type.STRING },
        edition: { type: Type.STRING },
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
        summary: { type: Type.STRING }
      },
      required: ['name', 'team', 'year', 'set', 'company', 'cardNumber', 'edition', 'details', 'overallGrade', 'gradeName', 'summary']
    };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            // Using Flash for speed as requested by user
            model: 'gemini-3-flash-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { 
              systemInstruction: NGA_SYSTEM_INSTRUCTION,
              safetySettings,
              temperature: 0.1, 
              responseMimeType: "application/json", 
              responseSchema,
              thinkingConfig: { thinkingBudget: 0 } // Disabled for speed
            }
        }),
        'full analysis'
    );
    return extractJson(response);
};

export const challengeGrade = async (card: CardData, direction: 'higher' | 'lower', onStatusUpdate: (status: string) => void): Promise<any> => {
    const ai = getAIClient();
    const prompt = `User challenges the grade of ${card.overallGrade} as too ${direction}. Re-evaluate specifically looking for evidence supporting a ${direction} grade. JSON output only.`;
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

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: dataUrlToBase64(card.frontImage) } },
                { inlineData: { mimeType: 'image/jpeg', data: dataUrlToBase64(card.backImage) } },
            ]},
            config: { 
              systemInstruction: NGA_SYSTEM_INSTRUCTION,
              safetySettings,
              temperature: 0.15,
              responseMimeType: "application/json", 
              responseSchema,
              thinkingConfig: { thinkingBudget: 0 }
            }
        }), 
        'challenge'
    );
    return extractJson(response);
};

export const regenerateCardAnalysisForGrade = async (frontImageBase64: string, backImageBase64: string, cardInfo: any, targetGrade: number, targetGradeName: string, onStatusUpdate: (status: string) => void): Promise<any> => {
    const ai = getAIClient();
    const prompt = `Justify a manual grade of ${targetGrade} (${targetGradeName}) using NGA rules. Highlight SPECIFIC visual evidence. JSON output only.`;
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
            config: { 
              systemInstruction: NGA_SYSTEM_INSTRUCTION,
              safetySettings,
              temperature: 0.1,
              responseMimeType: "application/json", 
              responseSchema,
              thinkingConfig: { thinkingBudget: 0 }
            }
        }), 
        'regenerate'
    );
    return extractJson(response);
};

export const getCardMarketValue = async (card: CardData): Promise<MarketValue> => {
    const ai = getAIClient();
    const query = `${card.year} ${card.company} ${card.set} ${card.name} #${card.cardNumber} Grade ${card.overallGrade}`;
    
    const prompt = `Search for market value of "${query}". Return JSON: averagePrice, minPrice, maxPrice, currency, notes.`;

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [{ text: prompt }] },
            config: { 
              safetySettings,
              tools: [{ googleSearch: {} }], 
              temperature: 0.1,
              thinkingConfig: { thinkingBudget: 0 }
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
