import { Router } from 'express';
import { analyzeImage } from './gemini.js';

export const analyzeRoutes = Router();

/**
 * POST /analyze
 * Body: { image: string }  (base64 JPEG, no data: prefix)
 * Returns: { observation: string }
 */
analyzeRoutes.post('/analyze', async (req, res) => {
  const { image } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'Missing "image" field in request body.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server.' });
  }

  try {
    console.log(`[${new Date().toISOString()}] Analyzing frame (${Math.round(image.length * 0.75 / 1024)} KB)`);

    const observation = await analyzeImage(image);

    console.log(`  → ${observation.substring(0, 100)}...`);

    return res.json({ observation });
  } catch (err) {
    console.error('Gemini error:', err.message);
    return res.status(500).json({ error: 'Gemini analysis failed: ' + err.message });
  }
});
