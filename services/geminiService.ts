
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

        if ((errStr.includes("daily") && errStr.includes("limit")) || errStr.includes("403") || errStr.includes("disabled")) {
            throw e; 
        }

        if (isRetryable && maxRetries > 0) {
            console.warn(`Gemini API Busy/Limited (${errStr}). Retrying ${maxRetries} more times...`);
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
        throw new Error("The AI took too long to respond.");
    }

    if (errorStr.includes("403") || errorStr.includes("permission_denied") || errorStr.includes("disabled")) {
        throw new Error("SERVICE_DISABLED: The Generative Language API is not enabled for this project.");
    }

    if (errorStr.includes("429") || errorStr.includes("quota") || errorStr.includes("resource_exhausted")) {
        if (errorStr.includes("daily") || errorStr.includes("20")) {
            throw new Error("DAILY_QUOTA_REACHED: You have used all 20 free requests for today.");
        }
        throw new Error("QUOTA_EXHAUSTED: You are sending requests too fast.");
    }

    if (errorStr.includes("503") || errorStr.includes("overloaded") || errorStr.includes("unavailable")) {
        throw new Error("SERVER_OVERLOADED: The AI model is currently busy. Try again shortly.");
    }
    
    throw new Error(e.message || "Unknown API Error");
};

const NGA_SYSTEM = `You are a professional NGA (Sports Card Grading) Expert. You MUST identify the card and then grade it strictly using the NGA whole-number system (1-10).

1. EVALUATION CRITERIA (Whole Numbers 1-10):
- CENTERING (25%): 10 (50/50-55/45), 9 (60/40), 8 (70/30), 7 (80/20), 6 (85/15), 5-1 (>90/10).
- CORNERS (25%): 10 (Razor sharp), 9 (One corner soft), 8 (Two corners touched), 7 (Visible wear), 6 (Rounding/fray), 5-4 (Rounded), 3-1 (Heavy wear/bent).
- EDGES (20%): 10 (Perfect), 9 (Tiny nick), 8 (Light wear), 7 (Noticeable whitening), 6 (Multiple nicks), 5-4 (Moderate chipping), 3-1 (Severe wear/peeling).
- SURFACE (20%): 10 (Flawless), 9 (Tiny line), 8 (Minor wear), 7 (Small dent/clouding), 6 (Multiple scratches), 5-4 (Scuffing), 3-1 (Creases/deep scratches/stains).
- PRINT QUALITY (10%): 10 (Sharp focus), 9 (Slight dot), 8 (Shadowing), 7 (Noticeable misprint), 6-4 (Poor color), 3-1 (Major error).

2. FINAL CALCULATION (Crucial):
- Start with the average of all five categories (round DOWN to nearest whole/half).
- PENALTY: If any category is 2+ grades below others, reduce final grade by 1.
- CAP: If SURFACE or CORNERS are < 6, max Overall Grade is 6.
- CAP: If the card has a CREASE, max Overall Grade is 5.

3. DESIGNATION MAP:
10: GEM MT, 9.5: MINT+, 9: MINT, 8.5: NM-MT+, 8: NM-MT, 7.5: NM+, 7: NM, 6.5: EX-MT+, 6: EX-MT, 5.5: EX+, 5: EX, 4.5: VG-EX+, 4: VG-EX, 3.5: VG+, 3: VG, 2.5: GOOD+, 2: GOOD, 1.5: FAIR, 1: POOR.

Return JSON ONLY. Identify the card first (Name, Team, Year, Set, Number).`;

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
                    { text: "STEP 1: Identify the card in the images (Year, Company, Set, Name, Team, #). STEP 2: Grade the card based on NGA standards. Return JSON: { \"name\": \"...\", \"team\": \"...\", \"year\": \"...\", \"set\": \"...\", \"company\": \"...\", \"cardNumber\": \"...\", \"edition\": \"...\", \"details\": { \"centering\": {\"grade\": 0, \"notes\": \"\"}, \"corners\": {\"grade\": 0, \"notes\": \"\"}, \"edges\": {\"grade\": 0, \"notes\": \"\"}, \"surface\": {\"grade\": 0, \"notes\": \"\"}, \"printQuality\": {\"grade\": 0, \"notes\": \"\"} }, \"overallGrade\": 0, \"gradeName\": \"...\", \"summary\": \"...\" }" },
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
                    { text: `Re-evaluate this card with a bias that the grade should be ${dir} than ${card.overallGrade}. Justify with new observations. Return updated JSON.` },
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
        
        const prompt = `
        The user has OVERRIDDEN the grade to: ${grade} (${gradeName}).
        
        CRITICAL TASK:
        1. YOU MUST REWRITE EVERY SINGLE "note" for centering, corners, edges, surface, and print quality. 
        2. If a sub-grade is 0 or note is "[Regenerate]", assign a whole number (1-10) and write a detailed note that MATHEMATICALLY results in the overall grade of ${grade} per NGA rules.
        3. If you must justify a 5.0, you MUST mention a crease in the surface notes.
        4. If you must justify a 6.0 or lower, you MUST mention corner rounding or surface defects.
        5. REWRITE the "summary" entirely. Do not use the old text. Justify why THIS specific card is exactly a ${grade}.
        
        Target Grade: ${grade} (${gradeName})
        Current Data (Modify to match target):
        - Centering: ${details.centering.grade}
        - Corners: ${details.corners.grade}
        - Edges: ${details.edges.grade}
        - Surface: ${details.surface.grade}
        - Print Quality: ${details.printQuality.grade}

        Return JSON matching this exact structure:
        {
          "overallGrade": ${grade},
          "gradeName": "${gradeName}",
          "details": {
            "centering": { "grade": number, "notes": "string" },
            "corners": { "grade": number, "notes": "string" },
            "edges": { "grade": number, "notes": "string" },
            "surface": { "grade": number, "notes": "string" },
            "printQuality": { "grade": number, "notes": "string" }
          },
          "summary": "WRITE NEW PROFESSIONAL ANALYSIS HERE"
        }
        `;

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
