import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MODEL = 'gemini-2.0-flash';

const SYSTEM_PROMPT = `You are a real-time whiteboard analysis assistant.
You receive webcam images of notebooks, whiteboards, or paper.
Your job is to briefly describe what you see — focusing on:
- Handwritten text or notes
- Mathematical equations or formulas
- Diagrams (flowcharts, state machines, UML, etc.)
- Code or pseudocode
- Arrows, graphs, or sketches

Keep your response to 1–3 concise sentences. Be specific and direct.`;

/**
 * Analyze a single base64-encoded JPEG frame.
 * @param {string} imageBase64 - Raw base64 (no data: prefix)
 * @returns {Promise<string>} - AI observation text
 */
export async function analyzeImage(imageBase64) {
  const model = genAI.getGenerativeModel({ model: MODEL });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBase64,
      },
    },
    {
      text: 'You are a helpful tutor. Look at this image of a notebook or whiteboard. First identify what is written or drawn, then actually solve or answer it. If you see a math equation, solve it. If you see a question, answer it. If you see a diagram, explain it. Be direct and give the answer, not just a description.', 
    },
  ]);

  const response = result.response;
  return response.text();
}
