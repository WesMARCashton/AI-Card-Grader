
import { GoogleGenAI, GenerateContentResponse, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { CardData, MarketValue } from "../types";

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
    // Per requirements, prioritize process.env.API_KEY.
    // We also check localStorage as a fallback for the manual entry from Settings.
    let apiKey = process.env.API_KEY;
    
    if (!apiKey || apiKey === 'undefined' || apiKey === '') {
        apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || '';
    }
    
    if (!apiKey) {
        throw new Error("API_KEY_MISSING");
    }
    
    return new GoogleGenAI({ apiKey });
};

const NGA_SYSTEM = `You are a professional NGA sports card grader. You are extremely strict. PSA 10s (Gem Mint) are rare. You analyze centering, corners, edges, and surface. Return your analysis in strict JSON format only.`;

export const analyzeCardFull = async (f64: string, b64: string): Promise<any> => {
    const ai = getAI();
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [
            { text: "Identify this card and provide a professional NGA grade. Return JSON: { \"name\": \"...\", \"team\": \"...\", \"year\": \"...\", \"set\": \"...\", \"company\": \"...\", \"cardNumber\": \"...\", \"edition\": \"...\", \"details\": { \"centering\": {\"grade\": 0, \"notes\": \"\"}, \"corners\": {\"grade\": 0, \"notes\": \"\"}, \"edges\": {\"grade\": 0, \"notes\": \"\"}, \"surface\": {\"grade\": 0, \"notes\": \"\"}, \"printQuality\": {\"grade\": 0, \"notes\": \"\"} }, \"overallGrade\": 0.0, \"gradeName\": \"...\", \"summary\": \"...\" }" },
            { inlineData: { mimeType: 'image/jpeg', data: f64 } },
            { inlineData: { mimeType: 'image/jpeg', data: b64 } },
        ]},
        config: { systemInstruction: NGA_SYSTEM, responseMimeType: "application/json", temperature: 0.1 }
    });
    return extractJson(response);
};

export const challengeGrade = async (card: CardData, dir: 'higher' | 'lower', cb: any): Promise<any> => {
    const ai = getAI();
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [
            { text: `The user believes this card deserves a ${dir} grade than ${card.overallGrade}. Re-evaluate strictly but consider the user's feedback. Return JSON with updated overallGrade, gradeName, details, and summary.` },
        ]},
        config: { systemInstruction: NGA_SYSTEM, responseMimeType: "application/json" }
    });
    return extractJson(response);
};

export const regenerateCardAnalysisForGrade = async (f64: string, b64: string, info: any, grade: number, name: string, cb: any): Promise<any> => {
    const ai = getAI();
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [
            { text: `The grader has assigned a manual grade of ${grade} (${name}). Please write a professional analysis and sub-grades that justify this specific score. Return JSON with details and summary.` },
        ]},
        config: { systemInstruction: NGA_SYSTEM, responseMimeType: "application/json" }
    });
    return extractJson(response);
};

export const getCardMarketValue = async (card: CardData): Promise<MarketValue> => {
    const ai = getAI();
    const query = `${card.year} ${card.company} ${card.set} ${card.name} ${card.cardNumber} Grade ${card.overallGrade} sold price ebay psa bgs`;
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Research the current market value for: ${query}. Focus on recent sold listings. Return JSON: { \"averagePrice\": 0, \"minPrice\": 0, \"maxPrice\": 0, \"currency\": \"USD\", \"notes\": \"...\" }`,
        config: { tools: [{ googleSearch: {} }] }
    });
    const data = extractJson(response);
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => ({ 
        title: c.web?.title || 'Market Source', 
        uri: c.web?.uri || '' 
    })).filter((s: any) => s.uri) || [];
    
    return { ...data, sourceUrls: sources };
};
