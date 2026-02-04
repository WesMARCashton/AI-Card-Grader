
import { GoogleGenAI, GenerateContentResponse, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { CardData, MarketValue } from "../types";

const extractJson = (response: GenerateContentResponse): any => {
    const text = response.text || "";
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || [null, text];
    try { return JSON.parse(match[1].trim()); }
    catch (e) { throw new Error("AI format error. Try again."); }
};

const getAI = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API_KEY_MISSING");
    return new GoogleGenAI({ apiKey });
};

const NGA_SYSTEM = `Professional NGA sports card grader. Strict. Award 10s sparingly. JSON only.`;

export const analyzeCardFull = async (f64: string, b64: string): Promise<any> => {
    const ai = getAI();
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [
            { text: "Identify and grade this card. Return JSON: name, team, year, set, company, cardNumber, edition, details (centering, corners, edges, surface, printQuality: {grade, notes}), overallGrade, gradeName, summary." },
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
            { text: `Re-evaluate this card. Previous grade ${card.overallGrade} challenged as too ${dir}. Return JSON with updated overallGrade, gradeName, details, and summary.` },
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
            { text: `Justify a manual grade of ${grade} (${name}). Return JSON with details and summary.` },
        ]},
        config: { systemInstruction: NGA_SYSTEM, responseMimeType: "application/json" }
    });
    return extractJson(response);
};

export const getCardMarketValue = async (card: CardData): Promise<MarketValue> => {
    const ai = getAI();
    const query = `${card.year} ${card.company} ${card.set} ${card.name} Grade ${card.overallGrade}`;
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Search value for ${query}. Return JSON: averagePrice, minPrice, maxPrice, currency, notes.`,
        config: { tools: [{ googleSearch: {} }] }
    });
    const data = extractJson(response);
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => ({ title: c.web?.title || 'Link', uri: c.web?.uri || '' })) || [];
    return { ...data, sourceUrls: sources };
};
