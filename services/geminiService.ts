
import { GoogleGenAI, GenerateContentResponse, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { CardData, EvaluationDetails, MarketValue } from "../types";
import { dataUrlToBase64 } from "../utils/fileUtils";

const extractJson = (response: GenerateContentResponse): any => {
    const text = response.text;
    if (!text || text.trim().length === 0) {
        const reason = response.candidates?.[0]?.finishReason;
        const safetyRatings = response.candidates?.[0]?.safetyRatings;
        console.error("AI returned empty content. Reason:", reason, "Safety:", safetyRatings);
        throw new Error(`AI returned an empty response (Reason: ${reason || 'Unknown'}). This usually happens if the content is flagged or the model is overloaded. Please try again with a clearer photo.`);
    }

    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = text.match(jsonRegex);
    const jsonString = (match && match[1]) ? match[1] : text;

    try {
        return JSON.parse(jsonString.trim());
    } catch (e) {
        console.error("Failed to parse JSON from AI response:", text);
        throw new Error("AI response was not in a valid format. Please try capturing the card again.");
    }
}

const handleGeminiError = (error: any, context: string): Error => {
    console.error(`Error in ${context}:`, error);
    let msg = error.message || "An unexpected error occurred.";

    if (msg.includes('model is overloaded') || msg.includes('busy')) {
        return new Error("The AI model is currently busy. Retrying... If this persists, please try again in a few minutes.");
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

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const NGA_GRADING_STANDARDS = `
--- START OF NGA GRADING STANDARDS ---
**STRICT PROFESSIONAL GRADING ONLY**

**Evaluation Categories (Subgrades)**
- **Centering (25%):** Border alignment. 10=50/50. 9=60/40. 8=65/35.
- **Corners (25%):** Sharpness. 10=Razor. 9.5=Hint of white. 9=Soft corner. 8=Rounded.
- **Edges (20%):** Border uniformity. 10=Zero nicks. 9=Minor silvering.
- **Surface (20%):** Gloss/Flaws. 10=Flawless. 9.5=One micro-line. 9=Scratch.
- **Print Quality (10%):** Registration.

**LOGIC RULES:**
- If Average ends in .25, round DOWN.
- If Average ends in .75, round DOWN to .5.
- **CREASE PENALTY:** Any crease caps card at 5.0.
- **LOW QUALITY PENALTY:** Surface/Corners < 6.0 caps overall at 6.0.

**INSTRUCTION:** Hunt for flaws. Do not default to 9.5. Most cards are 8s or 9s. Be extremely cynical. If you cannot see the back of the card, assume standard wear.
--- END OF NGA GRADING STANDARDS ---
`;

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
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
    const prompt = `Perform a cynical, flaw-focused NGA analysis of this card. ${NGA_GRADING_STANDARDS} Output valid JSON only.`;

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
              temperature: 0.0, 
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
    const prompt = `Write a 2-3 sentence report on why this card is a ${cardData.overallGrade}. Use subgrades: ${JSON.stringify(cardData.details)}. JSON: { "summary": string }`;
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
    const prompt = `The user challenges the grade of ${card.overallGrade} as too ${direction}. Re-evaluate using: ${NGA_GRADING_STANDARDS}. JSON output only.`;
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
    const prompt = `Justify a manual grade of ${targetGrade} (${targetGradeName}) for this card using NGA rules. JSON output only.`;
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
    const prompt = `Find recent eBay/Goldin/Heritage sold data for: "${query}". Output JSON: { "averagePrice": number, "minPrice": number, "maxPrice": number, "currency": string }.`;

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
        sourceUrls
    };
};
