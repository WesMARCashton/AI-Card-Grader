
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { CardData, EvaluationDetails, MarketValue } from "../types";
import { dataUrlToBase64 } from "../utils/fileUtils";

// Helper function to extract a JSON object from a string, which might be wrapped in markdown.
const extractJson = (text: string): any => {
    if (!text) {
        throw new Error("AI returned an empty response. This may be due to content restrictions or a temporary issue.");
    }

    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = text.match(jsonRegex);
    if (match && match[1]) {
        try {
            return JSON.parse(match[1]);
        } catch (e) {
            console.error("Failed to parse extracted JSON:", e);
            throw new Error("AI returned invalid JSON inside the markdown block.");
        }
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse the entire response as JSON:", e);
        throw new Error("AI response was not in the expected JSON format.");
    }
}

const handleGeminiError = (error: any, context: string): Error => {
    console.error(`Error in ${context} with Gemini API:`, error);
    
    let originalErrorMessage = error.message || (typeof error === 'string' ? error : `An unexpected error occurred during ${context}.`);
    let userFriendlyMessage = `An unexpected error occurred during ${context}. Please try again.`;

    if (originalErrorMessage.includes('{') && originalErrorMessage.includes('}')) {
        try {
            const parsedError = JSON.parse(originalErrorMessage.substring(originalErrorMessage.indexOf('{')));
            if (parsedError.error?.message) {
                originalErrorMessage = parsedError.error.message;
            }
        } catch (e) { /* Ignore */ }
    }

    if (originalErrorMessage.toLowerCase().includes('model is overloaded')) {
        userFriendlyMessage = "The AI model is currently overloaded. Please wait a moment and try again.";
    } else if (error instanceof SyntaxError || originalErrorMessage.includes('JSON')) {
        userFriendlyMessage = "The AI returned an invalid response. This can be intermittent. Please try again.";
    } else if (originalErrorMessage.toLowerCase().includes('fetch')) {
        userFriendlyMessage = "A network error occurred. Please check your internet connection and try again.";
    } else if (originalErrorMessage.includes('api key') || originalErrorMessage.includes('API Key is missing') || originalErrorMessage.includes('API_KEY_MISSING')) {
        return new Error("API_KEY_MISSING"); 
    } else {
        userFriendlyMessage = `An unexpected error occurred: ${originalErrorMessage}`;
    }
    
    return new Error(userFriendlyMessage);
};

const withRetry = async <T>(
  apiCall: () => Promise<T>,
  context: string,
  onRetry?: (attempt: number, delay: number) => void,
  retries = 10,
  initialDelay = 1000
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await apiCall();
    } catch (error: any) {
      lastError = error;
      let originalErrorMessage = error.message || '';
      if (originalErrorMessage.includes('{') && originalErrorMessage.includes('}')) {
        try {
          const parsedError = JSON.parse(originalErrorMessage.substring(originalErrorMessage.indexOf('{')));
          if (parsedError.error?.message) {
            originalErrorMessage = parsedError.error.message;
          }
        } catch (e) { /* Ignore */ }
      }

      const isRetryable = originalErrorMessage.toLowerCase().includes('model is overloaded') ||
                          originalErrorMessage.toLowerCase().includes('unavailable');

      if (isRetryable && i < retries - 1) {
        const delay = Math.min(initialDelay * Math.pow(2, i), 30000);
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
--- START OF NGA GRADING GUIDE ---

**CARD GRADING SYSTEM (Allows Half-Points e.g. 9.5, 8.5)**

**Overview of Categories**
Each card is evaluated in five key areas, each worth up to 10 points (increments of 0.5 are encouraged for high-end cards):
-   **Centering (Weight: 25%):** How well the image is centered front/back.
-   **Corners (Weight: 25%):** Sharpness and shape of all corners.
-   **Edges (Weight: 20%):** Cleanliness and uniformity of card borders.
-   **Surface (Weight: 20%):** Gloss, print marks, indentations, and scratches.
-   **Print Quality (Weight: 10%):** Focus, registration, and print defects.

**STEP 1: CENTERING (Front & Back)**
-   **Grade 10:** Perfect centering. Tolerance: 50/50 to 55/45 front.
-   **Grade 9.5:** Near perfect, virtually undetectable offset.
-   **Grade 9:** Slightly off-center. Tolerance: 60/40 front.
-   **Grade 8.5-1:** Progressively more off-center as per standard rules.

**STEP 2: CORNERS**
-   **Grade 10:** All four corners razor sharp.
-   **Grade 9.5:** One corner has the microscopic hint of a touch under magnification.
-   **Grade 9:** One corner slightly soft.

**STEP 3: EDGES**
-   **Grade 10:** Perfect, no nicks.
-   **Grade 9.5:** Flawless to the naked eye, one microscopic speck of white.

**STEP 4: SURFACE**
-   **Grade 10:** Flawless gloss.
-   **Grade 9.5:** One tiny, faint print line visible only under specific lighting.

**STEP 5: PRINT QUALITY**
-   **Grade 10:** Sharp focus, perfect registration.

**STEP 6: FINAL GRADE CALCULATION**
1.  Average the five subgrades.
2.  The final grade can be a whole number or a half-point (e.g., 9.5).
3.  Round the average to the nearest 0.5 increment (rounding DOWN if exactly between, e.g., 9.25 becomes 9.0, 9.75 becomes 9.5).
4.  Apply these adjustments:
    -   If one category is **2 or more grades below** the others -> **reduce final by 0.5 or 1 point**.
    -   If **surface or corners** subgrade is **below 6**, cap the overall grade at **6 maximum**.
    -   If the card has a **crease**, cap the grade at **5 automatically**.
    -   **Authentic (A)** may be used for cards that are genuine but too damaged to grade numerically.

--- END OF NGA GRADING GUIDE ---
`;

export interface CardIdentification {
    name: string;
    team: string;
    set: string;
    edition: string;
    cardNumber: string;
    company: string;
    year: string;
}

// Always use new GoogleGenAI({apiKey: process.env.API_KEY});
const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const identifyCard = async (frontImageBase64: string, backImageBase64: string): Promise<CardIdentification> => {
    const ai = getAIClient();
    const prompt = `
      **Task:** Identify the sports card from the provided images.
      **Instructions:** Analyze the images and determine the player name, team, year, set, manufacturer (company), card number, and any specific edition.
      **Output:** Return a single raw JSON object.
    `;
    
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
    };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            // Basic Text Tasks (e.g., identification and simple Q&A): 'gemini-3-flash-preview'
            model: 'gemini-3-flash-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: { 
              temperature: 0.1,
              responseMimeType: "application/json",
              responseSchema,
            }
        }),
        'identifying card'
    );
    return extractJson(response.text);
};

export const gradeCardPreliminary = async (frontImageBase64: string, backImageBase64: string): Promise<{ details: EvaluationDetails, overallGrade: number, gradeName: string }> => {
    const ai = getAIClient();
    const prompt = `
      **Task:** Perform a STRICT NGA grading analysis. Support half-points (e.g., 9.5).
      ${NGA_GRADING_GUIDE}
      **Instructions:**
      1. **Condition Analysis:** Assign subgrades (1-10, can be .5 increments) for Centering, Corners, Edges, Surface, Print Quality.
      2. **Final Calculation:** Calculate \`overallGrade\` strictly using Step 6.
      **Output:** Return a single raw JSON object.
    `;

    const subGradeDetailSchema = {
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
            centering: subGradeDetailSchema,
            corners: subGradeDetailSchema,
            edges: subGradeDetailSchema,
            surface: subGradeDetailSchema,
            printQuality: subGradeDetailSchema,
          },
        },
        overallGrade: { type: Type.NUMBER },
        gradeName: { type: Type.STRING },
      },
      required: ['details', 'overallGrade', 'gradeName'],
    };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            // Complex Text Tasks (e.g., advanced reasoning like grading): 'gemini-3-pro-preview'
            model: 'gemini-3-pro-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
             config: {
               temperature: 0.0,
               responseMimeType: "application/json",
               responseSchema,
             }
        }),
        'grading card preliminary'
    );
    return extractJson(response.text);
};

export const generateCardSummary = async (
    frontImageBase64: string, 
    backImageBase64: string, 
    cardData: Partial<CardData>
): Promise<string> => {
    const ai = getAIClient();
    const prompt = `
      **Task:** Write a professional NGA grading summary for this card.
      **Card:** ${cardData.year} ${cardData.company} ${cardData.name} #${cardData.cardNumber}
      **Grade:** ${cardData.overallGrade} (${cardData.gradeName})
      **Subgrades:** ${JSON.stringify(cardData.details)}
      
      **Instructions:**
      Write a concise, expert summary (2-3 sentences) that justifies the overall grade.
      
      **Output:** Return a single raw JSON object.
    `;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            summary: { type: Type.STRING }
        },
        required: ['summary']
    };

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            // Basic Text Tasks (e.g., summarization): 'gemini-3-flash-preview'
            model: 'gemini-3-flash-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: {
                temperature: 0.7,
                responseMimeType: "application/json",
                responseSchema,
            }
        }),
        'generating card summary'
    );
    
    const result = extractJson(response.text);
    return result.summary;
};

export const challengeGrade = async (
    card: CardData,
    direction: 'higher' | 'lower',
    onStatusUpdate: (status: string) => void
): Promise<{ details: EvaluationDetails, summary: string, overallGrade: number, gradeName: string }> => {
    onStatusUpdate('Initializing AI model for challenge...');
    const ai = getAIClient();

    const challengePrompt = `
      **Persona & Task:**
      You are reviewing a colleague's work. User challenged the grade as **${direction}**. Re-evaluate strictly using the NGA Guide. Support half-points.
      ${NGA_GRADING_GUIDE}
      **Initial Assessment:** ${JSON.stringify(card.details)}
    `;

    const subGradeDetailSchema = {
      type: Type.OBJECT,
      properties: { grade: { type: Type.NUMBER }, notes: { type: Type.STRING } },
      required: ['grade', 'notes'],
    };
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        overallGrade: { type: Type.NUMBER },
        gradeName: { type: Type.STRING },
        details: {
          type: Type.OBJECT,
          properties: {
            centering: subGradeDetailSchema,
            corners: subGradeDetailSchema,
            edges: subGradeDetailSchema,
            surface: subGradeDetailSchema,
            printQuality: subGradeDetailSchema,
          },
        },
        summary: { type: Type.STRING },
      },
      required: ['overallGrade', 'gradeName', 'details', 'summary'],
    };

    const frontImageBase64 = dataUrlToBase64(card.frontImage);
    const backImageBase64 = dataUrlToBase64(card.backImage);
    
    onStatusUpdate('Re-evaluating card...');
    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            // Complex Text Tasks (e.g., advanced reasoning): 'gemini-3-pro-preview'
            model: 'gemini-3-pro-preview',
            contents: { parts: [
                { text: challengePrompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: {
              responseMimeType: "application/json",
              responseSchema,
            }
        }), 
        'grade challenge'
    );

    onStatusUpdate('Finalizing re-evaluation...');
    const result = extractJson(response.text);
    return {
        details: result.details,
        summary: result.summary,
        overallGrade: result.overallGrade,
        gradeName: result.gradeName,
    };
};

export const regenerateCardAnalysisForGrade = async (
    frontImageBase64: string,
    backImageBase64: string,
    cardInfo: { name: string, team: string, set: string, edition: string, cardNumber: string, company: string, year: string },
    targetGrade: number,
    targetGradeName: string,
    onStatusUpdate: (status: string) => void
): Promise<{ details: EvaluationDetails, summary: string }> => {
    onStatusUpdate('Initializing AI model for analysis...');
    const ai = getAIClient();

    const prompt = `
      **Persona & Task:**
      Assign subgrades to justify a final grade of **${targetGrade} (${targetGradeName})**. Support half-points.
      ${NGA_GRADING_GUIDE}
    `;

    const subGradeDetailSchema = {
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
            centering: subGradeDetailSchema,
            corners: subGradeDetailSchema,
            edges: subGradeDetailSchema,
            surface: subGradeDetailSchema,
            printQuality: subGradeDetailSchema,
          },
        },
        summary: { type: Type.STRING },
      },
      required: ['details', 'summary'],
    };

    onStatusUpdate('Regenerating analysis report...');
    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            // Complex Text Tasks (e.g., advanced reasoning): 'gemini-3-pro-preview'
            model: 'gemini-3-pro-preview',
            contents: { parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: frontImageBase64 } },
                { inlineData: { mimeType: 'image/jpeg', data: backImageBase64 } },
            ]},
            config: {
              responseMimeType: "application/json",
              responseSchema,
            }
        }), 
        'analysis regeneration'
    );

    onStatusUpdate('Finalizing analysis report...');
    const result = extractJson(response.text);
    return {
        details: result.details,
        summary: result.summary,
    };
};

export const getCardMarketValue = async (
    card: CardData
): Promise<MarketValue> => {
    const ai = getAIClient();
    const gradeSearchTerm = card.gradeName ? `Grade ${card.overallGrade} ${card.gradeName}` : `Grade ${card.overallGrade}`;
    const cardSearchTerm = `${card.year} ${card.company} ${card.set} ${card.name} #${card.cardNumber} ${card.edition} ${gradeSearchTerm}`;

    const prompt = `
      **Task:** Find recent sold prices for a sports card.
      Query: "${cardSearchTerm}"
      Output JSON only.
    `;

    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            // Search Grounding example uses 'gemini-3-flash-preview'
            model: 'gemini-3-flash-preview',
            contents: { parts: [{ text: prompt }] },
            config: {
                tools: [{ googleSearch: {} }], 
                temperature: 0.1,
            }
        }),
        'getting market value'
    );

    const jsonText = response.text || "{}";
    let marketData: any = {};
    try {
        marketData = extractJson(jsonText);
    } catch (e) {
        throw new Error("Could not parse market value data.");
    }

    const sourceUrls: { title: string; uri: string }[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
        chunks.forEach((chunk: any) => {
            if (chunk.web?.uri && chunk.web?.title) {
                sourceUrls.push({ title: chunk.web.title, uri: chunk.web.uri });
            }
        });
    }

    return {
        averagePrice: typeof marketData.averagePrice === 'number' ? marketData.averagePrice : 0,
        minPrice: typeof marketData.minPrice === 'number' ? marketData.minPrice : 0,
        maxPrice: typeof marketData.maxPrice === 'number' ? marketData.maxPrice : 0,
        currency: marketData.currency || 'USD',
        lastSoldDate: marketData.lastSoldDate,
        notes: marketData.notes,
        sourceUrls: sourceUrls
    };
};
