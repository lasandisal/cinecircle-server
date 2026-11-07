// Put this at: cinecircle-be/src/scripts/testGemini.ts
// Run with:    npx tsx src/scripts/testGemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from '../config/env';

const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

(async () => {
  if (!ENV.GEMINI_API_KEY) {
    console.log('No GEMINI_API_KEY found in ENV');
    return;
  }
  const genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);

  for (const name of MODELS) {
    const started = Date.now();
    try {
      const model = genAI.getGenerativeModel({
        model: name,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent('Return JSON: {"ok": true}');
      console.log(`${name}: OK in ${Date.now() - started}ms ->`, result.response.text().trim());
    } catch (e: any) {
      console.log(`${name}: FAILED after ${Date.now() - started}ms ->`, e?.status, e?.message);
    }
  }
})();