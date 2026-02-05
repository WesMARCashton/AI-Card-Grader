
import { GoogleGenAI, GenerateContentResponse, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { CardData, MarketValue, EvaluationDetails } from "../types";
import { dataUrlToBase64 } from "../utils/fileUtils";

const API_KEY_STORAGE_KEY = 'manual_gemini_api_key';

const extractJson = (response: GenerateContentResponse): any => {
    const text = response.text || "";
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || [null, text];
    try { 
        const jsonStr = match[1] ? match[1].trim() : text.trim();
        return JSON.parse(jsonStr); 
    }
    catch (e) { 
        console.error("Failed to parse AI JSON:", text);
        throw new Error("AI format error. Please try grading again."); 
    }
};

const getAI = () => {
    let apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === 'undefined' || apiKey === '') {
        apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || '';
    }
    if (!apiKey) throw new Error("API_KEY_MISSING");
    return new GoogleGenAI({ apiKey });
};

/**
 * Executes a promise with a timeout.
 */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("API_TIMEOUT"));
        }, ms);
        promise.then(
            (res) => { clearTimeout(timer); resolve(res); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
};

/**
 * Retries with backoff and a hard 50s timeout.
 * Includes handling for 503 Overloaded and 429 Quota errors.
 */
const retryWithBackoff = async <T>(fn: () => Promise<T>, maxRetries = 4, delay = 5000): Promise<T> => {
    try {
        return await withTimeout(fn(), 50000); // 50s limit
    } catch (e: any) {
        const errStr = String(e).toLowerCase();
        if (e.message === "API_TIMEOUT") throw e;
        
        const isRetryable = 
            errStr.includes("429") || 
            errStr.includes("quota") || 
            errStr.includes("503") || 
            errStr.includes("overloaded") ||
            errStr.includes("unavailable") ||
            errStr.includes("resource_exhausted");

        // If it's specifically a daily limit error, retrying immediately won't help
        if (errStr.includes("daily") && errStr.includes("limit")) {
            throw e; 
        }

        if (isRetryable && maxRetries > 0) {
            console.warn(`Gemini API Busy/Limited (${errStr}). Retrying ${maxRetries} more times in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return retryWithBackoff(fn, maxRetries - 1, delay * 2);
        }
        throw e;
    }
};

const handleApiError = (e: any, context: string = "general") => {
    console.error(`Gemini API Error [${context}]:`, e);
    const errorStr = String(e).toLowerCase();
    
    if (e.message === "API_TIMEOUT") {
        throw new Error("The AI took too long to respond. This can happen on slow connections.");
    }

    if (errorStr.includes("429") || errorStr.includes("quota") || errorStr.includes("resource_exhausted")) {
        if (errorStr.includes("daily") || errorStr.includes("20")) {
            throw new Error("DAILY_QUOTA_REACHED: You have used all 20 free requests for today. To continue, you must enable billing in Google Cloud for your project.");
        }
        throw new Error("QUOTA_EXHAUSTED: You are sending requests too fast. Please wait 60 seconds.");
    }

    if (errorStr.includes("503") || errorStr.includes("overloaded") || errorStr.includes("unavailable")) {
        throw new Error("SERVER_OVERLOADED: The AI model is currently receiving too many requests. Please try again in a few moments.");
    }
    
    if (errorStr.includes("api_key_invalid") || errorStr.includes("key not found")) {
        throw new Error("API_KEY_INVALID: The provided API key is either incorrect or has been disabled.");
    }

    throw new Error(e.message || "Unknown API Error");
};

const NGA_SYSTEM = `You are a professional NGA sports card grader. You MUST strictly follow these NGA grading rules:

1. EVALUATION CATEGORIES (Score 1-10 each):
- CENTERING (25%): 10 (50/50-55/45), 9 (60/40), 8 (70/30), 7 (80/20), 6 (85/15), 5-1 (>90/10).
- CORNERS (25%): 10 (Razor sharp), 9 (Slightly soft), 8 (Two corners touched), 7 (Minor visible wear), 6 (Noticeable rounding), 5-4 (Rounded), 3-1 (Heavy wear).
- EDGES (20%): 10 (Perfect), 9 (Tiny nick), 8 (Light wear), 7 (Noticeable whitening), 6 (Multiple nicks), 5-4 (Moderate chipping), 3-1 (Severe wear).
- SURFACE (20%): 10 (Flawless), 9 (Tiny print line), 8 (Minor wear/light scratch), 7 (Small dent), 6 (Multiple scratches), 5-4 (Scuffing), 3-1 (Creases/deep scratches).
- PRINT QUALITY (10%): 10 (Sharp focus), 9 (Slight print dot), 8 (Shadowing), 7 (Noticeable misprint), 6-4 (Poor color), 3-1 (Major error).

2. FINAL GRADE CALCULATION:
- STEP A: Start with the average of all five categories (rounded DOWN to the nearest whole or half number).
- STEP B: Apply Penalties: If any category is 2+ grades below the others, reduce final grade by 1 point.
- STEP C: Apply Caps:
  - If SURFACE or CORNERS are below 6, the Overall Grade is CAPPED at 6.0.
  - If the card has a CREASE, the Overall Grade is CAPPED at 5.0.

3. DESIGNATION MAP:
10: GEM MT, 9.5: MINT+, 9: MINT, 8.5: NM-MT+, 8: NM-MT, 7.5: NM+, 7: NM, 6.5: EX-MT+, 6: EX-MT, 5.5: EX+, 5: EX, 4.5: VG-EX+, 4: VG-EX, 3.5: VG+, 3: VG, 2.5: GOOD+, 2: GOOD, 1.5: FAIR, 1: POOR.

Return JSON only.`;

export const testConnection = async (): Promise<{ success: boolean; message: string }> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: "Hi",
            config: { maxOutputTokens: 5 }
        });
        return { success: true, message: "Connection Successful!" };
    } catch (e: any) {
        return { success: false, message: e.message || "Connection failed." };
    }
};

export const analyzeCardFull = async (f64: string, b64: string): Promise<any> => {
    try {
        const ai = getAI();
        return await retryWithBackoff(async () => {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts: [
                    { text: "Identify this card and provide an NGA grade (1-10). Return JSON: { \"name\": \"...\", \"team\": \"...\", \"year\": \"...\", \"set\": \"...\", \"company\": \"...\", \"cardNumber\": \"...\", \"edition\": \"...\", \"details\": { \"centering\": {\"grade\": 0, \"notes\": \"\"}, \"corners\": {\"grade\": 0, \"notes\": \"\"}, \"edges\": {\"grade\": 0, \"notes\": \"\"}, \"surface\": {\"grade\": 0, \"notes\": \"\"}, \"printQuality\": {\"grade\": 0, \"notes\": \"\"} }, \"overallGrade\": 0, \"gradeName\": \"...\", \"summary\": \"...\" }" },
                    { inlineData: { mimeType: 'image/jpeg', data: f64 } },
                    { inlineData: { mimeType: 'image/jpeg', data: b64 } },
                ]},
                config: { systemInstruction: NGA_SYSTEM, responseMimeType: "application/json", temperature: 0.1 }
            });
            return extractJson(response);
        });
    } catch (e) {
        return handleApiError(e, "grading");
    }
};

export const getCardMarketValue = async (card: CardData): Promise<MarketValue> => {
    try {
        const ai = getAI();
        return await retryWithBackoff(async () => {
            const query = `${card.year} ${card.company} ${card.set} ${card.name} #${card.cardNumber} Grade ${card.overallGrade} sold price ebay psa`;
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: `Find market value for: ${query}. Return JSON: { \"averagePrice\": 0, \"minPrice\": 0, \"maxPrice\": 0, \"currency\": \"USD\", \"notes\": \"...\" }`,
                config: { tools: [{ googleSearch: {} }] }
            });
            const data = extractJson(response);
            const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => ({ 
                title: c.web?.title || 'Sold Listing', 
                uri: c.web?.uri || '' 
            })).filter((s: any) => s.uri) || [];
            
            return { ...data, sourceUrls: sources };
        });
    } catch (e) {
        return handleApiError(e, "market_value");
    }
};

export const challengeGrade = async (card: CardData, dir: 'higher' | 'lower', cb: any): Promise<any> => {
    try {
        const ai = getAI();
        const f64 = dataUrlToBase64(card.frontImage);
        const b64 = dataUrlToBase64(card.backImage);

        return await retryWithBackoff(async () => {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts: [
                    { text: `Re-evaluate this card with a bias that the grade should be ${dir} than ${card.overallGrade}. Return updated JSON.` },
                    { inlineData: { mimeType: 'image/jpeg', data: f64 } },
                    { inlineData: { mimeType: 'image/jpeg', data: b64 } },
                ]},
                config: { systemInstruction: NGA_SYSTEM, responseMimeType: "application/json", temperature: 0.2 }
            });
            return extractJson(response);
        });
    } catch (e) {
        return handleApiError(e, "challenging");
    }
};

export const regenerateCardAnalysisForGrade = async (f64: string, b64: string, card: CardData, grade: number, gradeName: string, details: EvaluationDetails): Promise<any> => {
    try {
        const ai = getAI();
        const breakdownContext = `
        User Request:
        - Target Overall Grade: ${grade} (${gradeName})
        
        Input Category Values (Strictly follow these numbers):
        - Centering: ${details.centering.grade} (Existing Note: ${details.centering.notes})
        - Corners: ${details.corners.grade} (Existing Note: ${details.corners.notes})
        - Edges: ${details.edges.grade} (Existing Note: ${details.edges.notes})
        - Surface: ${details.surface.grade} (Existing Note: ${details.surface.notes})
        - Print Quality: ${details.printQuality.grade} (Existing Note: ${details.printQuality.notes})
        `;

        const prompt = `The user has manually updated the numeric grades for this card. 
        
        YOUR TASK:
        1. REWRITE the "notes" for EVERY category to match the new numeric values provided. If a numeric value changed (e.g. from 8 to 10), delete the old note and write a new one that describes a card with that specific score.
        2. SMART FILL: If a category has the note "[Regenerate]", you must invent a score and note for that category so that the resulting NGA calculation matches the Target Overall Grade of ${grade}.
        3. ENSURE CONSISTENCY: The category notes must explain why the card received that score (e.g., if Edges is 10, notes should say "Perfect edges").
        4. REWRITE the "summary" (Official Grader Analysis) to be a high-quality professional justification for the final grade of ${grade}.
        
        Technical Context:
        ${breakdownContext}`;

        return await retryWithBackoff(async () => {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts: [
                    { text: prompt },
                    { inlineData: { mimeType: 'image/jpeg', data: f64 } },
                    { inlineData: { mimeType: 'image/jpeg', data: b64 } },
                ]},
                config: { 
                    systemInstruction: NGA_SYSTEM, 
                    responseMimeType: "application/json", 
                    temperature: 0.1 
                }
            });
            return extractJson(response);
        });
    } catch (e) {
        return handleApiError(e, "regenerating_summary");
    }
};
