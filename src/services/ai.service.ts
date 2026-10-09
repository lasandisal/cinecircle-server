import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from '../config/env';

export interface VibeParseResult {
  vibeSummary: string;
  suggestedGenres: string[];
  targetKeywords: string[];
  mood: string;
  maxRuntimeMinutes: number | null;
  rationale: string;
}

export interface GroupPitchInput {
  roomName: string;
  winnerTitle: string;
  winnerSynopsis: string;
  participants: {
    name: string;
    preferredMood?: string;
    votedYes: boolean;
    strength: number;
  }[];
}

export class AiService {
  private static genAI = ENV.GEMINI_API_KEY ? new GoogleGenerativeAI(ENV.GEMINI_API_KEY) : null;

  /**
   * Parse natural language vibe prompts into structured search parameters
   * e.g. "I want something like Inception meets Knives Out, but not scary and under 100 minutes"
   */
  static async parseVibePrompt(prompt: string): Promise<VibeParseResult> {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt cannot be empty');
    }

    if (this.genAI && ENV.GEMINI_API_KEY) {
      try {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const systemInstruction = `
You are CineCircle's AI Film Curator.
Analyze the user's natural language watch request and extract structured recommendation parameters.
Return ONLY valid JSON matching this schema:
{
  "vibeSummary": "Short 3-5 word essence of the request (e.g. Rainy Neo-Noir Mind-Bender)",
  "suggestedGenres": ["array", "of", "standard", "movie", "genres"],
  "targetKeywords": ["specific", "themes", "or", "tropes", "or", "styles"],
  "mood": "One primary mood: 'Comfort', 'Gripping', 'Mind-Bending', 'Fun', or 'Stunning'",
  "maxRuntimeMinutes": number or null if unspecified,
  "rationale": "One compelling sentence explaining why this search profile matches their exact feeling"
}
`;

        const result = await model.generateContent([
          systemInstruction,
          `User prompt: "${prompt}"`,
        ]);

        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]) as VibeParseResult;
        }
      } catch (error) {
        console.warn('[AiService] Gemini API call failed, using intelligent rule-based fallback:', error);
      }
    }

    // Intelligent heuristic fallback when Gemini API key is not yet set
    return this.fallbackVibeParser(prompt);
  }

  /**
   * Generate a charismatic, witty compromise pitch for group decision mode
   */
  static async generateGroupCompromisePitch(input: GroupPitchInput): Promise<string> {
    const { roomName, winnerTitle, winnerSynopsis, participants } = input;

    if (this.genAI && ENV.GEMINI_API_KEY) {
      try {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `
You are the charismatic AI moderator of a movie night watch room called "${roomName}".
The group's weighted voting has chosen the compromise winner: "${winnerTitle}".
Winner synopsis: "${winnerSynopsis}".

Participants and their votes:
${participants.map((p) => `- ${p.name}: voted ${p.votedYes ? 'YES' : 'NO'} (intensity: ${p.strength}/5), preferred mood: ${p.preferredMood || 'Any'}`).join('\n')}

Task:
Write a witty, persuasive, and fun 2-3 sentence compromise pitch to the room.
Acknowledge the different tastes playfully, explain why "${winnerTitle}" gives both sides something to love, and declare why debate is over and popcorn should be eaten.
Do not use bullet points or markdown headings. Keep it conversational.
`;

        const result = await model.generateContent(prompt);
        return result.response.text().trim();
      } catch (error) {
        console.warn('[AiService] Gemini pitch generation failed, using template fallback:', error);
      }
    }

    // Dynamic fallback pitch
    const yesCount = participants.filter((p) => p.votedYes).length;
    return `The compromise consensus is in: "${winnerTitle}" took the room with ${yesCount} out of ${participants.length} votes. It strikes the perfect middle ground between high tension and pure entertainment — settle into your seats and press play!`;
  }

  /**
   * Local rule-based fallback parser
   */
  private static fallbackVibeParser(prompt: string): VibeParseResult {
    const lower = prompt.toLowerCase();
    let mood = 'Comfort';
    if (lower.includes('thrill') || lower.includes('grip') || lower.includes('tense') || lower.includes('scary') || lower.includes('dark')) {
      mood = 'Gripping';
    } else if (lower.includes('mind') || lower.includes('twist') || lower.includes('sci-fi') || lower.includes('inception')) {
      mood = 'Mind-Bending';
    } else if (lower.includes('fun') || lower.includes('comedy') || lower.includes('laugh') || lower.includes('light')) {
      mood = 'Fun';
    } else if (lower.includes('visual') || lower.includes('beautiful') || lower.includes('cinematography')) {
      mood = 'Stunning';
    }

    // Extract runtime if mentioned e.g. "under 100 minutes" or "90 min"
    const runtimeMatch = lower.match(/(?:under|less than|around)?\s*(\d{2,3})\s*(?:min|minute|mins)/);
    const maxRuntimeMinutes = runtimeMatch ? parseInt(runtimeMatch[1], 10) : null;

    return {
      vibeSummary: `${mood} Cinema Experience`,
      suggestedGenres: ['Drama', 'Thriller', 'Sci-Fi'],
      targetKeywords: prompt.split(' ').filter((w) => w.length > 4).slice(0, 4),
      mood,
      maxRuntimeMinutes,
      rationale: `Derived tailored shortlist based on your prompt: "${prompt}"`,
    };
  }
}
