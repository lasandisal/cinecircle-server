

//////////////////////////////////////////////////////////////////////////////////////////

import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from '../config/env';

export type TitleType = 'film' | 'tv';

/**
 * Structured interpretation of the user's request.
 * BOTH Gemini and the local parser return exactly this shape, so the rest of
 * the pipeline never needs to know which one produced it.
 */
export interface VibeParseResult {
  // ---- existing fields (kept so the rest of the app keeps compiling) ----
  vibeSummary: string;
  /** SOFT preference. Used for TMDB retrieval + ranking, never as a hard filter. */
  suggestedGenres: string[];
  /** Kept for backwards compatibility. Now = coreConcepts + preferredThemes, NOT junk word trigrams. */
  targetKeywords: string[];
  /** HARD requirement when not null. */
  requestedType: TitleType | null;
  exclusions: string[];
  mood: string;
  maxRuntimeMinutes: number | null;
  rationale: string;
  source: 'gemini' | 'fallback';

  // ---- NEW: what the user actually asked for ----
  /** Original prompt, kept for relevance evaluation later. */
  originalPrompt: string;
  /** REQUIRED concepts (subject + setting). A title that misses these is rejected. */
  coreConcepts: string[];
  /** OPTIONAL themes. They improve the score but never reject a title. */
  preferredThemes: string[];
  /**
   * concept (lower-case) -> words/phrases that prove the concept appears in a
   * synopsis. Used by the local validator when Gemini is unavailable.
   */
  conceptEvidence: Record<string, string[]>;
}

/** A title (local DB or TMDB) that must be checked against the user's intent. */
export interface CandidateForEval {
  /** Unique string id, e.g. "tmdb:tv:1395" or "local:abc123". */
  id: string;
  name: string;
  type: TitleType;
  releaseYear?: number | null;
  genres: string[];
  synopsis: string;
}

export interface CandidateEvaluation {
  id: string;
  relevant: boolean;
  /** 0-100 */
  relevanceScore: number;
  matchedConcepts: string[];
  missingConcepts: string[];
  explanation: string;
  source: 'gemini' | 'local';
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

export interface GroupPitchResult {
  pitch: string;
  source: 'gemini' | 'fallback';
}

/* -------------------------------------------------------------------------- */
/*  Local concept lexicon                                                     */
/* -------------------------------------------------------------------------- */
/**
 * Small deterministic dictionary used by the local parser AND to expand
 * Gemini's concepts into "evidence words" for the local validator.
 * Add new entries here over time - this is what makes the fallback "smart".
 */
interface LexiconEntry {
  concept: string;
  /** subject/setting => REQUIRED, theme => OPTIONAL */
  kind: 'subject' | 'setting' | 'theme';
  triggers: RegExp[]; // matched against the lower-cased PROMPT (no /g flag!)
  evidence: string[]; // matched against the lower-cased SYNOPSIS
}

const LEXICON: LexiconEntry[] = [
  {
    concept: 'teenagers',
    kind: 'subject',
    triggers: [/\bteen(s|age|agers?)?\b/, /\bhigh[- ]?school\b/],
    evidence: ['teen', 'high school', 'adolescen', 'prep school', 'coming-of-age', 'coming of age'],
  },
  {
    concept: 'Upper East Side',
    kind: 'setting',
    triggers: [/upper east side/, /\bues\b/],
    evidence: ['upper east side', 'manhattan'],
  },
  {
    concept: 'Manhattan',
    kind: 'setting',
    triggers: [/manhattan/, /new york/, /\bnyc\b/],
    evidence: ['manhattan', 'new york', 'nyc'],
  },
  {
    concept: 'school',
    kind: 'subject',
    triggers: [/\bschool\b/],
    evidence: ['school', 'student', 'teacher', 'classmate', 'campus'],
  },
  {
    concept: 'space exploration',
    kind: 'subject',
    triggers: [/\bspace\b/, /\bastronauts?\b/],
    evidence: ['space', 'astronaut', 'nasa', 'spacecraft', 'galaxy', 'planet', 'mars', 'cosmos'],
  },
  {
    concept: 'supernatural',
    kind: 'subject',
    triggers: [/supernatural|paranormal|\bghosts?\b|witch\w*|vampires?|werewol\w+|\bdemons?\b/],
    evidence: ['supernatural', 'paranormal', 'ghost', 'witch', 'vampire', 'werewol', 'demon', 'magic', 'monster'],
  },
  {
    concept: 'time travel',
    kind: 'subject',
    triggers: [/time[- ]travel|time loop/],
    evidence: ['time travel', 'time loop', 'timeline', 'past and future'],
  },
  {
    concept: 'heist',
    kind: 'subject',
    triggers: [/\bheists?\b|\brobber(y|ies)\b/],
    evidence: ['heist', 'robbery', 'robber', 'steal', 'vault'],
  },
  {
    concept: 'small town',
    kind: 'setting',
    triggers: [/small[- ]town/],
    evidence: ['small town', 'town'],
  },
  {
    concept: 'wealthy elite',
    kind: 'theme',
    triggers: [/\b(rich|wealth\w*|elite|privileged|affluent|upper[- ]class|socialites?)\b/],
    evidence: ['wealth', 'rich', 'elite', 'privileged', 'affluent', 'socialite', 'upper class', 'prep school'],
  },
  {
    concept: 'private school',
    kind: 'theme',
    triggers: [/\b(private|boarding|prep(aratory)?) schools?\b/],
    evidence: ['private school', 'boarding school', 'prep school', 'preparatory', 'academy'],
  },
];

const GENRE_ALIASES: Record<string, string> = {
  comedy: 'Comedy', funny: 'Comedy', hilarious: 'Comedy', sitcom: 'Comedy',
  thriller: 'Thriller', suspense: 'Thriller',
  mystery: 'Mystery', crime: 'Crime', drama: 'Drama',
  romance: 'Romance', romantic: 'Romance',
  horror: 'Horror', scary: 'Horror',
  action: 'Action', adventure: 'Adventure',
  fantasy: 'Fantasy', animation: 'Animation',
  documentary: 'Documentary', 'sci-fi': 'Science Fiction',
  'science fiction': 'Science Fiction',
};

const VALID_MOODS = ['Comfort', 'Gripping', 'Mind-Bending', 'Fun', 'Stunning'];

const PHRASE_STOP_WORDS = new Set([
  'want', 'something', 'with', 'that', 'this', 'under', 'minutes', 'minute', 'series', 'movie',
  'movies', 'film', 'films', 'about', 'show', 'shows', 'the', 'and', 'some', 'good', 'great',
  'best', 'like', 'from', 'have', 'into', 'where', 'there', 'their', 'them',
]);

/* ----------------------------- small helpers ------------------------------ */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary-aware match. "teen" matches "teenagers" (prefix) but NOT
 * "nineteen". The OLD code used plain `.includes()`, which produced exactly
 * that kind of false positive.
 */
function hasTerm(text: string, term: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return false;
  if (t.includes(' ') || t.includes('-')) return text.includes(t);
  return new RegExp(`\\b${escapeRe(t)}`).test(text);
}

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9'-]+/)
    .filter((w) => w.length > 3 && !PHRASE_STOP_WORDS.has(w));
}

/** Turn a concept ("Upper East Side") into proof-words for synopsis matching. */
function evidenceFor(concept: string): string[] {
  const lc = concept.toLowerCase();
  const terms = new Set<string>();
  for (const entry of LEXICON) {
    if (entry.concept.toLowerCase() === lc || entry.triggers.some((t) => t.test(lc))) {
      entry.evidence.forEach((e) => terms.add(e));
    }
  }
  if (terms.size === 0) {
    // Unknown concept: fall back to its own significant words.
    significantWords(lc).forEach((w) => terms.add(w));
  }
  terms.add(lc);
  return Array.from(terms);
}

function buildEvidence(concepts: string[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const c of concepts) map[c.toLowerCase()] = evidenceFor(c);
  return map;
}

function strArr(value: unknown, max = 10): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

/* -------------------------------------------------------------------------- */
/*  Local (deterministic) candidate evaluation                                */
/* -------------------------------------------------------------------------- */
/**
 * Conservative fallback validator used when Gemini is down. It only checks
 * whether the REQUIRED concepts have evidence in the title's own text, so it
 * will reject some good titles (acceptable) but will not let unrelated
 * popular titles through (the actual bug).
 */
function localEvaluate(intent: VibeParseResult, c: CandidateForEval): CandidateEvaluation {
  const reject = (explanation: string, missing: string[] = []): CandidateEvaluation => ({
    id: c.id, relevant: false, relevanceScore: 0, matchedConcepts: [], missingConcepts: missing,
    explanation, source: 'local',
  });

  if (intent.requestedType && c.type !== intent.requestedType) {
    return reject(`Wrong content type (wanted ${intent.requestedType}).`);
  }
  if (!c.synopsis || !c.synopsis.trim()) {
    return reject('No synopsis available, so relevance cannot be verified.');
  }

  const text = [c.name, c.synopsis, ...c.genres].join(' ').toLowerCase();
  const required = intent.coreConcepts;

  if (required.length === 0) {
    // Nothing specific was asked for (e.g. "something good"): nothing to gate on.
    return {
      // Must be >= the controller's RELEVANCE_THRESHOLD (60), otherwise a vague prompt
      // rejects EVERY title (this was 50, which caused the "No specific concepts" wipe-out).
      id: c.id, relevant: true, relevanceScore: 70, matchedConcepts: [], missingConcepts: [],
      explanation: 'No specific concepts in the request.', source: 'local',
    };
  }

  const matches = (concept: string) =>
    (intent.conceptEvidence[concept.toLowerCase()] ?? evidenceFor(concept)).some((term) => hasTerm(text, term));

  const matched = required.filter(matches);
  const missing = required.filter((r) => !matched.includes(r));
  const ratio = matched.length / required.length;
  // 1-2 required concepts: ALL must match. 3+: at least 2/3.
  const needed = required.length <= 2 ? 1 : 0.67;

  if (ratio < needed) {
    return reject(`Missing core concepts: ${missing.join(', ')}.`, missing);
  }

  const themeHits = intent.preferredThemes.filter(matches);
  const themeBonus = intent.preferredThemes.length
    ? Math.round((themeHits.length / intent.preferredThemes.length) * 15)
    : 0;
  const score = Math.min(100, Math.round(60 + ratio * 25 + themeBonus));

  return {
    id: c.id,
    relevant: true,
    relevanceScore: score,
    matchedConcepts: [...matched, ...themeHits],
    missingConcepts: missing,
    explanation: `Synopsis matches: ${[...matched, ...themeHits].join(', ')}.`,
    source: 'local',
  };
}

/* -------------------------------------------------------------------------- */
/*  Service                                                                   */
/* -------------------------------------------------------------------------- */

export class AiService {
  private static genAI = ENV.GEMINI_API_KEY ? new GoogleGenerativeAI(ENV.GEMINI_API_KEY) : null;
  private static aiDisabledUntil = 0;
  private static consecutiveFailures = 0;

  // Can be overridden with GEMINI_MODEL in .env (e.g. gemini-2.5-flash-lite) if the default is slow.
  private static readonly MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  private static aiAvailable(): boolean {
    return !!(this.genAI && ENV.GEMINI_API_KEY && Date.now() >= this.aiDisabledUntil);
  }

  private static recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3) {
      this.aiDisabledUntil = Date.now() + 60_000;
      this.consecutiveFailures = 0;
    }
  }

  /** Transient failures (429 / 503) are worth a retry; 404 / 400 are not. */
  private static async withRetry<T>(operation: () => Promise<T>, attempts = 1): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        const status = err?.status ?? err?.response?.status;
        const transient = status === 429 || status === 503 || status === 500;
        if (!transient || attempt === attempts - 1) throw err;
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  }

  private static withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini request timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /* ----------------------------- STEP 1 + 2 ------------------------------ */

  /**
   * Parse a natural-language prompt into a structured intent.
   * Gemini first, deterministic local parser as a safety net. Both return the
   * same structure.
   */
  static async parseVibePrompt(prompt: string): Promise<VibeParseResult> {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt cannot be empty');
    }
    const cleanPrompt = prompt.trim();
    const local = this.fallbackVibeParser(cleanPrompt);

    if (!this.aiAvailable()) return local;

    try {
      const model = this.genAI!.getGenerativeModel({
        model: this.MODEL,
        generationConfig: { responseMimeType: 'application/json' },
      });

      const systemInstruction = `
You are CineCircle's AI watch curator for films and TV series.
Understand WHAT the user wants to watch, not just which genre it belongs to.
The request may describe a movie, a TV series, or either. Never assume "film" unless the user says so.
Separate REQUIRED concepts (the subject and setting the title must really be about) from OPTIONAL themes.
Return ONLY valid JSON matching this schema:
{
  "vibeSummary": "Short 3-5 word essence of the request",
  "requestedType": "'film', 'tv', or null if the user did not say",
  "coreConcepts": ["REQUIRED subject/setting concepts, 1-4 items, e.g. 'teenagers', 'Upper East Side', 'Manhattan'"],
  "preferredThemes": ["OPTIONAL themes, e.g. 'wealthy lifestyle', 'private schools', 'social rivalry'"],
  "suggestedGenres": ["standard film/TV genres that usually fit - a soft hint only"],
  "targetKeywords": ["2-6 short searchable keywords"],
  "exclusions": ["genres or themes to avoid, only if the user said so"],
  "mood": "One of: 'Comfort', 'Gripping', 'Mind-Bending', 'Fun', 'Stunning'",
  "maxRuntimeMinutes": number or null if unspecified,
  "rationale": "One sentence explaining why this interpretation matches the request"
}
`;

      const result = await this.withTimeout(
        this.withRetry(() => model.generateContent([systemInstruction, `User prompt: "${cleanPrompt}"`]), 3),
        Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 15000) // Increased: Gemini can be slow; local fallback still covers timeouts
      );

      const jsonMatch = result.response.text().match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Gemini returned no parsable JSON');
      const raw = JSON.parse(jsonMatch[0]);

      // NEVER spread raw model output into the result (the old `...parsed`).
      // Validate every field and fall back to the local value per field.
      const geminiType =
        raw.requestedType === 'tv' ? 'tv' : raw.requestedType === 'film' || raw.requestedType === 'movie' ? 'film' : null;

      const coreConcepts = strArr(raw.coreConcepts, 5);
      const finalCore = coreConcepts.length > 0 ? coreConcepts : local.coreConcepts;
      const preferredThemes = strArr(raw.preferredThemes, 8);
      const finalThemes = preferredThemes.length > 0 ? preferredThemes : local.preferredThemes;
      const exclusions = Array.from(new Set([...local.exclusions, ...strArr(raw.exclusions, 6)]));
      const suggestedGenres = strArr(raw.suggestedGenres, 5).filter(
        (g) => !exclusions.some((e) => e.toLowerCase() === g.toLowerCase())
      );

      this.consecutiveFailures = 0;
      return {
        vibeSummary: typeof raw.vibeSummary === 'string' && raw.vibeSummary.trim() ? raw.vibeSummary.trim() : local.vibeSummary,
        suggestedGenres,
        targetKeywords: Array.from(new Set([...finalCore, ...finalThemes, ...strArr(raw.targetKeywords, 6)])).slice(0, 12),
        // An explicit "series"/"movie" word in the prompt is deterministic, so it wins over the model.
        requestedType: local.requestedType ?? geminiType,
        exclusions,
        mood: VALID_MOODS.includes(raw.mood) ? raw.mood : local.mood,
        maxRuntimeMinutes:
          typeof raw.maxRuntimeMinutes === 'number' && raw.maxRuntimeMinutes > 0
            ? raw.maxRuntimeMinutes
            : local.maxRuntimeMinutes,
        rationale: typeof raw.rationale === 'string' && raw.rationale.trim() ? raw.rationale.trim() : local.rationale,
        source: 'gemini',
        originalPrompt: cleanPrompt,
        coreConcepts: finalCore,
        preferredThemes: finalThemes,
        conceptEvidence: buildEvidence([...finalCore, ...finalThemes]),
      };
    } catch (error: any) {
      this.recordFailure();
      console.warn('[AiService] Gemini vibe parse failed, using local parser:', error?.message || error);
      return local;
    }
  }

  /**
   * Deterministic local parser. Same output structure as Gemini.
   *
   * OLD behaviour (the bug): any word longer than 4 characters became a
   * "keyword", and random word trigrams became "phrases" ("teen upper east").
   * Those junk keywords were then merged into Gemini's result AND used to
   * filter titles. Now we extract real concepts from a lexicon plus
   * "about X" / "set in X" phrases.
   */
  private static fallbackVibeParser(prompt: string): VibeParseResult {
    const lower = prompt.toLowerCase();

    // ---- mood (only used for scoring) ----
    let mood = 'Comfort';
    if (/thrill|grip|tense|scary|dark/.test(lower)) mood = 'Gripping';
    else if (/mind|twist|sci-fi|inception/.test(lower)) mood = 'Mind-Bending';
    else if (/\bfun\b|comedy|laugh|light/.test(lower)) mood = 'Fun';
    else if (/visual|beautiful|cinematography/.test(lower)) mood = 'Stunning';

    // ---- exclusions ("not scary", "without horror") ----
    const exclusions = Array.from(
      new Set(
        Object.entries(GENRE_ALIASES)
          .filter(([alias]) => new RegExp(`(?:not|avoid|without)\\s+(?:any\\s+)?${escapeRe(alias)}\\b`).test(lower))
          .map(([, genre]) => genre)
      )
    );

    // ---- genres: soft hints. Genres the user EXCLUDED are removed (old code
    // could suggest "Horror" and exclude "Horror" for "not scary"). ----
    const suggestedGenres = Array.from(
      new Set(
        Object.entries(GENRE_ALIASES)
          .filter(([alias]) => lower.includes(alias))
          .map(([, genre]) => genre)
      )
    ).filter((g) => !exclusions.includes(g));

    // ---- content type ----
    // "show me a movie" must not count as a TV request.
    const cleaned = lower.replace(/\bshow\s+(me|us|them)\b/g, ' ');
    const tvHit = /\b(series|shows?|episodes?|seasons?|tv|sitcoms?)\b/.test(cleaned);
    const filmHit = /\b(movies?|films?|cinema)\b/.test(cleaned);
    const requestedType: TitleType | null = tvHit && !filmHit ? 'tv' : filmHit && !tvHit ? 'film' : null;

    // ---- runtime ----
    const runtimeMatch = lower.match(/(?:under|less than|within|around)?\s*(\d{2,3})\s*(?:min|minute|mins|minutes)/);
    const maxRuntimeMinutes = runtimeMatch ? parseInt(runtimeMatch[1], 10) : null;

    // ---- concepts from the lexicon ----
    let coreConcepts: string[] = [];
    let preferredThemes: string[] = [];
    for (const entry of LEXICON) {
      if (entry.triggers.some((t) => t.test(lower))) {
        (entry.kind === 'theme' ? preferredThemes : coreConcepts).push(entry.concept);
      }
    }

    // ---- generic phrases: "about X", "set in X" ----
    const known = new Set(
      [...coreConcepts, ...preferredThemes].flatMap((c) => evidenceFor(c))
    );
    const phraseRe =
      /\b(?:about|set in|featuring|involving|centered on)\s+([a-z0-9' -]{3,40}?)(?=\s+(?:and|but|with|that|under|not|without)\b|[,.!?]|$)/g;
    let m: RegExpExecArray | null;
    while ((m = phraseRe.exec(lower)) !== null) {
      const words = significantWords(m[1]);
      if (words.length === 0) continue;
      const alreadyCovered = words.some((w) =>
        Array.from(known).some((k) => k.startsWith(w) || w.startsWith(k))
      );
      if (!alreadyCovered) coreConcepts.push(m[1].trim());
    }

    // Only themes were found ("rich families")? Then they ARE the request.
    if (coreConcepts.length === 0 && preferredThemes.length > 0) {
      coreConcepts = preferredThemes;
      preferredThemes = [];
    }

    coreConcepts = Array.from(new Set(coreConcepts)).slice(0, 5);
    preferredThemes = Array.from(new Set(preferredThemes)).slice(0, 6);

    return {
      vibeSummary: `${mood} Watch Experience`,
      suggestedGenres,
      targetKeywords: [...coreConcepts, ...preferredThemes],
      requestedType,
      exclusions,
      mood,
      maxRuntimeMinutes,
      rationale: `Interpreted your request as: ${
        coreConcepts.length ? coreConcepts.join(', ') : 'a general watch recommendation'
      }.`,
      source: 'fallback',
      originalPrompt: prompt,
      coreConcepts,
      preferredThemes,
      conceptEvidence: buildEvidence([...coreConcepts, ...preferredThemes]),
    };
  }

  /* ------------------------------- STEP 4 -------------------------------- */

  /**
   * Semantic relevance validation.
   *
   * Gemini JUDGES candidates that TMDB/DB already returned; it does not invent
   * new ones. All candidates go in ONE request (batched) to save latency/quota.
   * Anything Gemini skips, or all of them if Gemini fails, goes through the
   * conservative local validator.
   *
   * Hard constraints (content type) are re-checked in code and are never left
   * to the model.
   */
  static async evaluateCandidates(
    intent: VibeParseResult,
    candidates: CandidateForEval[]
  ): Promise<Map<string, CandidateEvaluation>> {
    const out = new Map<string, CandidateEvaluation>();
    if (candidates.length === 0) return out;

    const byId = new Map(candidates.map((c) => [c.id, c]));

    if (this.aiAvailable()) {
      try {
        const model = this.genAI!.getGenerativeModel({
          model: this.MODEL,
          generationConfig: { responseMimeType: 'application/json' },
        });

        const instruction = `
You are a strict relevance judge for a film/TV recommender.
You are given a user's request and candidate titles with their official overviews.
Do NOT recommend or invent titles. ONLY evaluate the candidates provided.

For each candidate decide whether its ACTUAL storyline satisfies the REQUIRED concepts.
- A title that shares only one broad trait (e.g. "has teenagers") but misses the required
  setting/subject is NOT relevant.
- If the overview is empty or too vague to verify, set relevant=false.
- Content type must match when one was requested.
- Optional themes only raise the score; they never decide relevance.

Return ONLY a JSON array, one item per candidate, echoing "id" exactly:
[{"id":"...","relevant":true|false,"relevanceScore":0-100,"matchedConcepts":["..."],"missingConcepts":["..."],"explanation":"one short sentence"}]
`;

        const payload = {
          originalPrompt: intent.originalPrompt,
          requestedType: intent.requestedType,
          requiredConcepts: intent.coreConcepts,
          optionalThemes: intent.preferredThemes,
          exclusions: intent.exclusions,
          candidates: candidates.map((c) => ({
            id: c.id,
            title: c.name,
            type: c.type,
            year: c.releaseYear ?? null,
            genres: c.genres,
            overview: (c.synopsis || '').slice(0, 350),
          })),
        };

        const result = await this.withTimeout(
          this.withRetry(() => model.generateContent([instruction, JSON.stringify(payload)]), 3),
          Number(process.env.GEMINI_EVAL_TIMEOUT_MS || 20000)
        );

        const arrMatch = result.response.text().match(/\[[\s\S]*\]/);
        if (!arrMatch) throw new Error('Gemini returned no evaluation array');
        const parsed = JSON.parse(arrMatch[0]);
        if (!Array.isArray(parsed)) throw new Error('Gemini evaluation is not an array');

        for (const item of parsed) {
          const id = String(item?.id ?? '');
          const cand = byId.get(id);
          if (!cand || out.has(id)) continue;

          const scoreNum = Number(item.relevanceScore);
          const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : 0;
          let relevant = item.relevant === true;
          let explanation = typeof item.explanation === 'string' ? item.explanation : '';

          // Deterministic guard: wrong content type is always a rejection.
          if (intent.requestedType && cand.type !== intent.requestedType) {
            relevant = false;
            explanation = `Wrong content type (wanted ${intent.requestedType}).`;
          }

          out.set(id, {
            id,
            relevant,
            relevanceScore: relevant ? score : Math.min(score, 40),
            matchedConcepts: strArr(item.matchedConcepts, 8),
            missingConcepts: strArr(item.missingConcepts, 8),
            explanation,
            source: 'gemini',
          });
        }
        this.consecutiveFailures = 0;
      } catch (error: any) {
        this.recordFailure();
        console.warn('[AiService] Gemini candidate evaluation failed, using local validator:', error?.message || error);
      }
    }

    // Anything Gemini did not answer for (or everything, if it failed).
    for (const c of candidates) {
      if (!out.has(c.id)) out.set(c.id, localEvaluate(intent, c));
    }
    return out;
  }

  /* ------------------------- unchanged: group pitch ---------------------- */

  /**
   * Generate a charismatic, witty compromise pitch for group decision mode
   */
  static async generateGroupCompromisePitch(input: GroupPitchInput): Promise<GroupPitchResult> {
    const { roomName, winnerTitle, winnerSynopsis, participants } = input;

    if (this.genAI && ENV.GEMINI_API_KEY) {
      try {
        const model = this.genAI.getGenerativeModel({ model: this.MODEL });

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

        const result = await this.withRetry(() => model.generateContent(prompt));
        const pitch = result.response.text().trim();
        if (pitch) {
          return { pitch, source: 'gemini' };
        }
        throw new Error('Gemini returned an empty pitch');
      } catch (error: any) {
        console.warn(
          '[AiService] Gemini pitch generation failed, using template fallback:',
          error?.message || error
        );
      }
    }

    // Template fallback - reported honestly as NOT generated by Gemini.
    const yesCount = participants.filter((p) => p.votedYes).length;
    return {
      pitch: `The compromise consensus is in: "${winnerTitle}" took the room with ${yesCount} out of ${participants.length} votes. It strikes the perfect middle ground between high tension and pure entertainment — settle into your seats and press play!`,
      source: 'fallback',
    };
  }
}