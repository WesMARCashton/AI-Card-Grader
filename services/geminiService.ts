
import { GoogleGenAI, GenerateContentResponse, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { CardData, MarketValue } from "../types";
// Add missing import
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
 * Retries a function with exponential backoff if a 429 error is detected.
 */
const retryWithBackoff = async <T>(fn: () => Promise<T>, maxRetries = 2, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (e: any) {
        const errStr = String(e).toLowerCase();
        if ((errStr.includes("429") || errStr.includes("quota")) && maxRetries > 0) {
            console.warn(`Gemini 429 hit. Retrying in ${delay}ms... (${maxRetries} left)`);
            await new Promise(r => setTimeout(r, delay));
            return retryWithBackoff(fn, maxRetries - 1, delay * 2);
        }
        throw e;
    }
};

const handleApiError = (e: any, context: string = "general") => {
    console.error(`Gemini API Error [${context}]:`, e);
    const errorStr = String(e).toLowerCase();
    
    if (errorStr.includes("429") || errorStr.includes("quota") || errorStr.includes("resource_exhausted")) {
        const billingKeywords = ["billing", "check your plan", "project", "paid"];
        const isBillingRestricted = billingKeywords.some(k => errorStr.includes(k));
        
        if (context === "market_value") {
            throw new Error(isBillingRestricted ? "SEARCH_BILLING_ISSUE" : "SEARCH_QUOTA_EXHAUSTED");
        }
        
        if (isBillingRestricted) {
            throw new Error("BILLING_LINK_REQUIRED");
        }
        throw new Error("QUOTA_EXHAUSTED");
    }
    
    if (errorStr.includes("api_key_invalid") || errorStr.includes("key not found")) {
        throw new Error("API_KEY_INVALID");
    }

    throw new Error(e.message || "Unknown API Error");
};

const NGA_SYSTEM = `You are a professional NGA sports card grader. Strict. PSA 10s are rare. Analysis centering, corners, edges, and surface. Return JSON only.`;

export const testConnection = async (): Promise<{ success: boolean; message: string }> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            // Fix: Use correct model name for basic verification tasks
            model: 'gemini-3-flash-preview',
            contents: "Hi",
            config: { maxOutputTokens: 5 }
        });
        return { success: true, message: "Connection Successful! Your key is communicating with Gemini." };
    } catch (e: any) {
        const err = String(e).toLowerCase();
        if (err.includes("429") || err.includes("quota")) {
            return { success: false, message: "Quota reached. Your account is functional but you are exceeding speed limits." };
        }
        return { success: false, message: e.message || "Connection failed. Verify your key." };
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

// Fix: Complete challengeGrade function and fix shorthand config property error
export const challengeGrade = async (card: CardData, dir: 'higher' | 'lower', cb: any): Promise<any> => {
    try {
        const ai = getAI();
        const f64 = dataUrlToBase64(card.frontImage);
        const b64 = dataUrlToBase64(card.backImage);

        return await retryWithBackoff(async () => {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts: [
                    { text: `Re-evaluate this card with a bias that the grade should be ${dir} than ${card.overallGrade}. Return updated JSON with full NGA grading details.` },
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

// Fix: Add missing regenerateCardAnalysisForGrade export used in App.tsx
export const regenerateCardAnalysisForGrade = async (f64: string, b64: string, card: CardData, grade: number, gradeName: string, cb: any): Promise<any> => {
    try {
        const ai = getAI();
        return await retryWithBackoff(async () => {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts: [
                    { text: `The user has manually set the grade to ${grade} (${gradeName}). Please rewrite the grader analysis summary to align with this new grade while keeping identification info the same. Return full JSON.` },
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
