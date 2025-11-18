import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { CardData, EvaluationDetails } from "../types";
import { dataUrlToBase64 } from "../utils/fileUtils";

// Helper function to extract a JSON object from a string, which might be wrapped in markdown.
const extractJson = (text: string): any => {
    // Add this guard to handle empty/undefined responses from the AI.
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
    // As a fallback, try to parse the whole string
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse the entire response as JSON:", e);
        throw new Error("AI response was not in the expected JSON format.");
    }
}

/**
 * A centralized error handler for Gemini API calls.
 * It parses potential JSON errors and provides user-friendly messages.
 * @param error The catched error object.
 * @param context A string describing the operation (e.g., 'rating card').
 * @returns A new Error object with a user-friendly message.
 */
const handleGeminiError = (error: any, context: string): Error => {
    console.error(`Error in ${context} with Gemini API:`, error);
    
    let originalErrorMessage = error.message || (typeof error === 'string' ? error : `An unexpected error occurred during ${context}.`);
    let userFriendlyMessage = `An unexpected error occurred during ${context}. Please try again.`;

    // Attempt to parse a JSON error from the message
    if (originalErrorMessage.includes('{') && originalErrorMessage.includes('}')) {
        try {
            const parsedError = JSON.parse(originalErrorMessage.substring(originalErrorMessage.indexOf('{')));
            if (parsedError.error?.message) {
                originalErrorMessage = parsedError.error.message;
            }
        } catch (e) { /* Ignore parsing errors, proceed with original message */ }
    }

    if (originalErrorMessage.toLowerCase().includes('model is overloaded')) {
        userFriendlyMessage = "The AI model is currently overloaded. Please wait a moment and try again.";
    } else if (error instanceof SyntaxError || originalErrorMessage.includes('JSON')) {
        userFriendlyMessage = "The AI returned an invalid response. This can be intermittent. Please try again.";
    } else if (originalErrorMessage.toLowerCase().includes('fetch')) {
        userFriendlyMessage = "A network error occurred. Please check your internet connection and try again.";
    } else if (originalErrorMessage.includes('api key') || originalErrorMessage.includes('API Key is missing') || originalErrorMessage.includes('API_KEY_MISSING')) {
        // Keep this specific string so App.tsx can catch it and show the modal
        return new Error("API_KEY_MISSING"); 
    } else {
        userFriendlyMessage = `An unexpected error occurred: ${originalErrorMessage}`;
    }
    
    return new Error(userFriendlyMessage);
};


/**
 * Wraps a Gemini API call with a retry mechanism for transient errors.
 * @param apiCall The async function that makes the API call.
 * @param context A string describing the operation for error logging.
 * @param onRetry Optional callback to report retry attempts.
 * @param retries The number of times to retry.
 * @param initialDelay The initial delay in ms for exponential backoff.
 * @returns The result of the API call.
 */
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
        } catch (e) { /* Ignore parsing errors */ }
      }

      const isRetryable = originalErrorMessage.toLowerCase().includes('model is overloaded') ||
                          originalErrorMessage.toLowerCase().includes('unavailable');

      if (isRetryable && i < retries - 1) {
        // Exponential backoff with a 30-second cap on the delay.
        const delay = Math.min(initialDelay * Math.pow(2, i), 30000);
        console.log(`Attempt ${i + 1} failed for ${context}. Retrying in ${delay}ms...`);
        onRetry?.(i + 1, delay);
        await new Promise(res => setTimeout(res, delay));
      } else {
        // Not a retryable error or this was the last retry attempt.
        throw handleGeminiError(error, context);
      }
    }
  }
  // This part is unreachable due to the throw in the catch block, but it's here for type safety.
  throw handleGeminiError(lastError, context);
};


const NGA_GRADING_GUIDE = `
--- START OF NGA GRADING GUIDE ---

**CARD GRADING SYSTEM (Whole Numbers Only)**

**Overview of Categories**
Each card is evaluated in five key areas, each worth up to 10 points:
-   **Centering (Weight: 25%):** How well the image is centered front/back.
-   **Corners (Weight: 25%):** Sharpness and shape of all corners.
-   **Edges (Weight: 20%):** Cleanliness and uniformity of card borders.
-   **Surface (Weight: 20%):** Gloss, print marks, indentations, and scratches.
-   **Print Quality (Weight: 10%):** Focus, registration, and print defects.

**STEP 1: CENTERING (Front & Back)**
-   **Grade 10:** Perfect centering, borders even. Tolerance: 50/50 to 55/45 front, 60/40 back.
-   **Grade 9:** Slightly off-center but clean. Tolerance: 60/40 front, 65/35 back.
-   **Grade 8:** Noticeable but acceptable. Tolerance: 70/30 front, 75/25 back.
-   **Grade 7:** Clearly off-center, no tilt. Tolerance: 80/20 front, 85/15 back.
-   **Grade 6:** Strongly off-center or tilted. Tolerance: 85/15 front, 90/10 back.
-   **Grade 5-1:** Progressively more off-center, image misaligned, borders touching or cut off. Tolerance: Over 90/10.

**STEP 2: CORNERS**
-   **Grade 10:** All four corners razor sharp, no fraying.
-   **Grade 9:** One corner slightly soft or touched.
-   **Grade 8:** Two corners lightly touched, no fraying.
-   **Grade 7:** Minor visible wear on multiple corners.
-   **Grade 6:** Noticeable rounding or fray starting.
-   **Grade 5-4:** Rounded or obviously worn corners.
-   **Grade 3-1:** Heavy wear, folding, or bent corners.

**STEP 3: EDGES**
-   **Grade 10:** Perfect, no nicks or chipping.
-   **Grade 9:** One tiny nick or faint chipping.
-   **Grade 8:** Light wear on one or two edges.
-   **Grade 7:** Noticeable but minor edge whitening.
-   **Grade 6:** Multiple nicks, slight roughness.
-   **Grade 5-4:** Moderate chipping or edge wear visible from top view.
-   **Grade 3-1:** Severe edge wear, peeling, or layering.

**STEP 4: SURFACE**
-   **Grade 10:** Flawless gloss, no print lines or scratches.
-   **Grade 9:** Tiny print line or faint mark.
-   **Grade 8:** Minor surface wear, one light scratch.
-   **Grade 7:** Small print line, small dent, or faint clouding.
-   **Grade 6:** Multiple small scratches or light impression.
-   **Grade 5-4:** Scuffing, minor indents, dull gloss.
-   **Grade 3-1:** Creases, deep scratches, or severe staining.

**STEP 5: PRINT QUALITY**
-   **Grade 10:** Sharp focus, perfect registration, clean color.
-   **Grade 9:** Slight print dot or faint color shift.
-   **Grade 8:** Slight misregistration (color shadowing).
-   **Grade 7:** Noticeable misprint or focus softening.
-   **Grade 6-4:** Poor color alignment or faded print.
-   **Grade 3-1:** Major print error, missing color, or smearing.

**STEP 6: FINAL GRADE CALCULATION**
1.  Start with the average of all five category subgrades.
2.  Round the average DOWN to the nearest whole number.
3.  Apply these adjustments:
    -   If one category is **2 or more grades below** the others -> **reduce final by 1 point**.
    -   If **surface or corners** subgrade is **below 6**, cap the overall grade at **6 maximum**.
    -   If the card has a **crease**, cap the grade at **5 automatically**.
    -   **Authentic (A)** may be used for cards that are genuine but too damaged to grade numerically.

--- END OF NGA GRADING GUIDE ---
`;

const GRADE_NAME_MAP: { [key: number]: string } = {
      10: 'GEM MT',
      9: 'MINT',
      8: 'NM-MT',
      7: 'NM',
      6: 'EX-MT',
      5: 'EX',
      4: 'VG-EX',
      3: 'VG',
      2: 'GOOD',
      1: 'POOR'
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

// Helper to safely initialize the AI client
const getAIClient = () => {
  // Explicitly check window.env existence to avoid TS errors or runtime issues
  const env = (window as any).env;
  
  // Priority 1: Server Injected Key
  let apiKey = env?.VITE_API_KEY;
  
  // Priority 2: Local Dev Key
  if (!apiKey) {
      apiKey = import.meta.env?.VITE_API_KEY;
  }

  // Priority 3: Manual Local Storage Key (Fallback)
  if (!apiKey) {
      apiKey = localStorage.getItem('gemini_api_key');
  }

  if (!apiKey) {
      // Log helpful info for debugging in the browser console
      console.error("Gemini API Key Check Failed.");
      throw new Error("API_KEY_MISSING");
  }
  return new GoogleGenAI({ apiKey });
};

// Helper to save manual key
export const saveManualApiKey = (key: string) => {
    localStorage.setItem('gemini_api_key', key);
};

// STEP 1: Identify the card
export const identifyCard = async (frontImageBase64: string, backImageBase64: string): Promise<CardIdentification> => {
    const ai = getAIClient();
    const prompt = `
      **Task:** Identify the sports card from the provided images.
      **Instructions:** Analyze the images and determine the player name, team, year, set, manufacturer (company), card number, and any specific edition (e.g., 'Base', 'Chrome').
      **Output:** Return a single raw JSON object.
      **JSON Schema:**
      {
        "name": string,
        "team": string,
        "set": string,
        "edition": string,
        "cardNumber": string,
        "company": string,
        "year": string
      }
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
            model: 'gemini-2.5-flash',
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


// STEP 2 & 3 Combined: Grade the card's condition, calculate final grade, and write summary
export const gradeAndSummarizeCard = async (frontImageBase64: string, backImageBase64: string): Promise<{ details: EvaluationDetails, overallGrade: number, gradeName: string, summary: string }> => {
    const ai = getAIClient();
    const prompt = `
      **Task:** Perform a complete NGA grading analysis of the provided card images.
      ${NGA_GRADING_GUIDE}
      **Instructions:**
      1.  **Condition Analysis:** For each of the five categories (Centering, Corners, Edges, Surface, Print Quality), assign a whole number subgrade (1-10) and provide brief notes explaining your reasoning, referencing the guide.
      2.  **Final Calculation:** Follow **STEP 6** of the NGA guide precisely to calculate the final \`overallGrade\`.
      3.  **Determine Grade Name:** Use the final grade to determine the correct \`gradeName\` from the provided mapping.
      4.  **Write Summary:** Write a brief, expert 'summary' of the card's condition based on the subgrades.
      **Output:** Return a single raw JSON object.
      **JSON Schema:**
      {
        "details": {
          "centering": { "grade": number, "notes": string },
          "corners": { "grade": number, "notes": string },
          "edges": { "grade": number, "notes": string },
          "surface": { "grade": number, "notes": string },
          "printQuality": { "grade": number, "notes": string }
        },
        "overallGrade": number,
        "gradeName": string,
        "summary": string
      }
    `;

    const subGradeDetailSchema = {
      type: Type.OBJECT,
      properties: { grade: { type: Type.INTEGER }, notes: { type: Type.STRING } },
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
        overallGrade: { type: Type.INTEGER },
        gradeName: { type: Type.STRING },
        summary: { type: Type.STRING },
      },
      required: ['details', 'overallGrade', 'gradeName', 'summary'],
    };


    const response = await withRetry<GenerateContentResponse>(
        () => ai.models.generateContent({
            model: 'gemini-2.5-pro',
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
        'grading card condition'
    );
    return extractJson(response.text);
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
      You are a head NGA grader reviewing a colleague's work. A user has challenged the initial grade, believing it should be **${direction}**. Your task is to perform a meticulous re-evaluation of the card images with this challenge in mind, strictly following the NGA Grading Guide.

      ${NGA_GRADING_GUIDE}

      **Initial Assessment Data:**
      - **Card:** ${card.year} ${card.company} ${card.set} #${card.cardNumber} - ${card.name}
      - **Initial Grade:** ${card.overallGrade} (${card.gradeName})
      - **Initial Notes:** ${JSON.stringify(card.details, null, 2)}
      - **User Challenge:** The user believes the grade should be **${direction}**.

      **Execution Steps:**
      1.  **Focused Re-evaluation:** Re-examine the card images, applying the NGA Grading Guide with a bias.
          -   If the challenge is **'higher'**, look for evidence that initial flaws were overestimated according to the guide.
          -   If the challenge is **'lower'**, scrutinize the card for subtle flaws (e.g., micro-fractures, print dots) that may have been missed but are defined in the guide.

      2.  **Generate New Analysis:** Provide a new, final assessment. You must either revise the grade or defend the original one based *only* on the guide.
          -   Recalculate the final grade by strictly following **STEP 6** of the guide. The final grade MUST be a whole number.
          -   Determine the new \`gradeName\` based on the final grade (e.g., 10: GEM MT, 9: MINT).

      3.  **Generate Summary:** Write a new 'summary' that is your response to the user's challenge.
          -   **It MUST begin with one of two phrases: "Upon re-evaluation, I am maintaining the grade because..." OR "Upon re-evaluation, I have adjusted the grade because...".**
          -   Provide specific evidence from the images, referencing the NGA guide, to justify your final decision.

      4.  **JSON Output Generation:** Populate the following JSON structure and return it as a raw JSON object.

      **JSON Schema:**
      {
        "overallGrade": number, // Final calculated WHOLE NUMBER grade
        "gradeName": string,
        "details": {
          "centering": { "grade": number, "notes": string },
          "corners": { "grade": number, "notes": string },
          "edges": { "grade": number, "notes": string },
          "surface": { "grade": number, "notes": string },
          "printQuality": { "grade": number, "notes": string }
        },
        "summary": string
      }
    `;

    const subGradeDetailSchema = {
      type: Type.OBJECT,
      properties: { grade: { type: Type.INTEGER }, notes: { type: Type.STRING } },
      required: ['grade', 'notes'],
    };
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        overallGrade: { type: Type.INTEGER },
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
            model: 'gemini-2.5-pro',
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
        'grade challenge',
        () => {
            onStatusUpdate('Analysis is taking longer than expected. Still working...');
        }
    );

    if (!response.text) {
        console.error("Gemini response was blocked or empty in challengeGrade.", response);
        const finishReason = response.candidates?.[0]?.finishReason;
        let message = "The AI's response to the challenge was empty. This can happen due to content policy violations or other restrictions.";
        if (finishReason === 'SAFETY') {
            message = "The AI's response was blocked for safety reasons during the challenge.";
        } else if (finishReason) {
            message = `The AI's response was incomplete during the challenge due to: ${finishReason}.`;
        }
        throw new Error(message);
    }
    
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
      You are a veteran NGA card grader. The final grade for this card has been set to **${targetGrade} (${targetGradeName})**. Your task is to perform a detailed evaluation of the card images and write a report that meticulously justifies this specific grade, strictly following the official NGA Grading Guide.

      ${NGA_GRADING_GUIDE}
      
      **Card Details:**
      - **Player:** ${cardInfo.name}
      - **Year:** ${cardInfo.year}
      - **Set:** ${cardInfo.set}
      - **Company:** ${cardInfo.company}
      - **Card Number:** ${cardInfo.cardNumber}

      **Execution Steps:**
      1.  **Justification-Based Analysis:** Closely examine the card images to find the specific evidence that supports the assigned grade of **${targetGrade}** according to the NGA guide.
          -   For high grades (9-10), focus on near-perfect qualities and pinpoint minuscule flaws as defined in the guide.
          -   For mid-range grades (6-8), identify a combination of minor-to-moderate flaws defined in the guide.
          -   For lower grades (1-5), document the significant defects described in the guide.

      2.  **Generate Justification Report:** Write a new 'summary' and 'details' that serve as your official report.
          -   The **'summary'** must clearly state the primary reasons for the ${targetGrade} grade, referencing the NGA standard.
          -   The **'details'** object must contain whole number subgrades for each category that logically support the final grade according to the guide's calculation rules. The 'notes' for each must describe specific observations.

      3.  **JSON Output Generation:** Populate the following JSON structure and return it as a raw JSON object.

      **JSON Schema:**
      {
        "details": {
          "centering": { "grade": number, "notes": string },
          "corners": { "grade": number, "notes": string },
          "edges": { "grade": number, "notes": string },
          "surface": { "grade": number, "notes": string },
          "printQuality": { "grade": number, "notes": string }
        },
        "summary": string // A new summary that expertly justifies the provided grade based on the NGA guide.
      }
    `;

    const subGradeDetailSchema = {
      type: Type.OBJECT,
      properties: { grade: { type: Type.INTEGER }, notes: { type: Type.STRING } },
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
            model: 'gemini-2.5-pro',
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
        'analysis regeneration',
        () => {
            onStatusUpdate('Analysis is taking longer than expected. Still working...');
        }
    );

    if (!response.text) {
        console.error("Gemini response was blocked or empty in regenerateCardAnalysisForGrade.", response);
        const finishReason = response.candidates?.[0]?.finishReason;
        let message = "The AI's response for analysis regeneration was empty. This can happen due to content policy violations or other restrictions.";
        if (finishReason === 'SAFETY') {
            message = "The AI's response was blocked for safety reasons during analysis regeneration.";
        } else if (finishReason) {
            message = `The AI's response was incomplete during analysis regeneration due to: ${finishReason}.`;
        }
        throw new Error(message);
    }
    
    onStatusUpdate('Finalizing analysis report...');
    const result = extractJson(response.text);
    return {
        details: result.details,
        summary: result.summary,
    };
};