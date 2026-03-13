// ── server.js ─────────────────────────────────────────────────────────────────
// Mentora backend.
// - All AI endpoints → Vertex AI (ADC auth, no API key)
// - WebSocket /live  → Gemini Live API (key from Secret Manager)
// ─────────────────────────────────────────────────────────────────────────────

import express  from 'express';
import cors     from 'cors';
import dotenv   from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { VertexAI } from '@google-cloud/vertexai';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

import { PERSONAS } from './personas.js';
import {
  DETECT_SUBJECT_FROM_IMAGE,
  detectSubjectFromMessage,
  analyzePrompt,
  chatSystemPrompt,
  liveVoiceSystemPrompt,
  voiceReformatPrompt,
  practiceTestPrompt,
  summarizePrompt,
  flashcardsPrompt,
} from './prompts.js';

import {
  DETECT_COMPLEXITY_FROM_IMAGE,
  detectComplexityFromMessage,
  detectComplexityFromText,
  hardComplexityOverride,
} from './complexity.js';

dotenv.config();

const PROJECT  = process.env.GCP_PROJECT || 'mentora-main';
const LOCATION = 'us-central1';
const PORT     = process.env.PORT || 3001;

// ── Vertex AI client ──────────────────────────────────────────────────────────
const vertex = new VertexAI({ project: PROJECT, location: LOCATION });

function getModel(modelName, systemInstruction) {
  return vertex.getGenerativeModel({
    model: modelName,
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
  });
}

// ── Secret Manager — load Live API key once at startup ────────────────────────
let LIVE_API_KEY = null;

async function loadLiveApiKey() {
  try {
    const client = new SecretManagerServiceClient();
    const name   = `projects/${PROJECT}/secrets/GEMINI_API_KEY/versions/latest`;
    const [ver]  = await client.accessSecretVersion({ name });
    LIVE_API_KEY = ver.payload.data.toString('utf8').trim();
    console.log('[Secret Manager] Live API key loaded ✓');
  } catch (err) {
    console.error('[Secret Manager] Failed:', err.message);
    console.warn('WebSocket /live will not work without GEMINI_API_KEY secret.');
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

console.log('\n=== STARTUP ===');
console.log(`Project:  ${PROJECT}`);
console.log(`Location: ${LOCATION}`);
console.log('===============\n');

// ── Subject detection ─────────────────────────────────────────────────────────

const SUBJECT_MAP = {
  'math':'Math','mathematics':'Math','maths':'Math','binary':'Math',
  'numbersystems':'Math','numbertheory':'Math','arithmetic':'Math',
  'algebra':'Math','calculus':'Math','geometry':'Math','statistics':'Math',
  'physics':'Physics','chemistry':'Chemistry','chem':'Chemistry',
  'biology':'Biology','bio':'Biology','computerscience':'ComputerScience',
  'computingscience':'ComputerScience','cs':'ComputerScience',
  'coding':'ComputerScience','programming':'ComputerScience',
  'computing':'ComputerScience','technology':'ComputerScience',
  'history':'History','literature':'Literature','english':'Literature',
  'economics':'Economics','econ':'Economics','other':'Other',
};

function detectSubjectFromText(raw) {
  const firstWord  = raw.trim().split(/[\n\r\s,\.;:]+/)[0];
  const normalised = firstWord.toLowerCase().replace(/[\s_\-\.]/g, '');
  const subject    = SUBJECT_MAP[normalised] || 'Other';
  console.log(` -> Subject: "${subject}"`);
  return subject;
}

function getText(result) {
  return result.response.candidates[0].content.parts[0].text;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', project: PROJECT, liveKey: LIVE_API_KEY ? 'loaded' : 'missing' });
});

// ── POST /detect-subject ──────────────────────────────────────────────────────

app.post('/detect-subject', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  try {
    const model   = getModel('gemini-2.0-flash');
    const result  = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: detectSubjectFromMessage(message) }] }] });
    const subject = detectSubjectFromText(getText(result));
    res.json({ subject });
  } catch (err) {
    console.error('detect-subject error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /analyze  (streaming SSE) ───────────────────────────────────────────

app.post('/analyze', async (req, res) => {
  const { image, subjectOverride } = req.body;
  if (!image) return res.status(400).json({ error: 'Missing image' });
  sseSetup(res);
  try {
    console.log(`[${new Date().toISOString()}] /analyze`);
    const model     = getModel('gemini-2.5-flash');
    const imagePart = { inlineData: { mimeType: 'image/jpeg', data: image } };
    let subject = subjectOverride || null;
    let complexity = 'intermediate';

    if (!subject) {
      const [sr, cr] = await Promise.all([
        model.generateContent({ contents: [{ role: 'user', parts: [imagePart, { text: DETECT_SUBJECT_FROM_IMAGE }] }] }),
        model.generateContent({ contents: [{ role: 'user', parts: [imagePart, { text: DETECT_COMPLEXITY_FROM_IMAGE }] }] }),
      ]);
      subject    = detectSubjectFromText(getText(sr));
      complexity = detectComplexityFromText(getText(cr));
    } else {
      const cr = await model.generateContent({ contents: [{ role: 'user', parts: [imagePart, { text: DETECT_COMPLEXITY_FROM_IMAGE }] }] });
      complexity = detectComplexityFromText(getText(cr));
    }

    console.log(` -> subject=${subject}, complexity=${complexity}`);
    sseWrite(res, 'subject', { subject });

    const persona      = PERSONAS[subject] || PERSONAS.Other;
    const streamResult = await getModel('gemini-2.5-flash').generateContentStream({
      contents: [{ role: 'user', parts: [imagePart, { text: analyzePrompt(persona, complexity, subject) }] }],
    });

    let fullText = '';
    for await (const chunk of streamResult.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) { fullText += text; sseWrite(res, 'chunk', { text }); }
    }
    sseWrite(res, 'done', { observation: fullText, subject });
    res.end();
  } catch (err) {
    console.error('Analyze error:', err.message);
    sseWrite(res, 'error', { error: err.message });
    res.end();
  }
});

// ── POST /chat  (streaming SSE) ───────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { message, history = [], subject = 'Other', voiceMode = false, lastComplexity = null, fileData = null } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  sseSetup(res);
  try {
    console.log(`[${new Date().toISOString()}] /chat [${subject}]: "${message.slice(0,60)}"`);

    const detectModel   = getModel('gemini-2.0-flash');
    const activeSubject = fileData
      ? subject
      : detectSubjectFromText(getText(await detectModel.generateContent({ contents: [{ role: 'user', parts: [{ text: detectSubjectFromMessage(message) }] }] })));

    const override   = hardComplexityOverride(message);
    const complexity = override || lastComplexity || 'intermediate';

    if (!override && history.length > 0) {
      detectModel.generateContent({ contents: [{ role: 'user', parts: [{ text: detectComplexityFromMessage(message, history) }] }] })
        .then(r => { if (res.writable) sseWrite(res, 'complexity', { complexity: detectComplexityFromText(getText(r)) }); })
        .catch(e => console.error('Background complexity error:', e.message));
    }

    const persona   = PERSONAS[activeSubject] || PERSONAS.Other;
    const sysPrompt = voiceMode
      ? voiceReformatPrompt(persona, complexity, activeSubject)
      : chatSystemPrompt(persona, complexity, activeSubject, null);

    const modelName = (complexity === 'advanced' || fileData) ? 'gemini-2.5-flash' : 'gemini-2.0-flash';
    console.log(` -> model=${modelName}, subject=${activeSubject}, complexity=${complexity}`);

    const chatModel     = getModel(modelName, sysPrompt);
    const vertexHistory = history.map(h => ({
      role:  h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));
    const chat = chatModel.startChat({ history: vertexHistory });

    if (activeSubject !== subject) sseWrite(res, 'subject', { subject: activeSubject });
    sseWrite(res, 'complexity', { complexity });

    const messageParts = [];
    if (fileData?.data && fileData?.mimeType) {
      messageParts.push({ inlineData: { mimeType: fileData.mimeType, data: fileData.data } });
    }
    messageParts.push({ text: message });

    const streamResult = await chat.sendMessageStream(messageParts);
    let fullReply = '';
    for await (const chunk of streamResult.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) { fullReply += text; sseWrite(res, 'chunk', { text }); }
    }
    sseWrite(res, 'done', { reply: fullReply });
    res.end();
  } catch (err) {
    console.error('Chat error:', err.message);
    sseWrite(res, 'error', { error: err.message });
    res.end();
  }
});

// ── POST /generate-image (stub — not available on Vertex AI) ──────────────────

app.post('/generate-image', (_req, res) => {
  res.status(501).json({ error: 'Image generation is not available on Vertex AI.' });
});

// ── POST /practice-test ───────────────────────────────────────────────────────

app.post('/practice-test', async (req, res) => {
  const { contentType='text', files=[], text='', sessionHistory=[], subject='Other', difficulty=2, numQuestions=10, questionTypes=['multiple_choice','short_answer'] } = req.body;
  try {
    console.log(`[${new Date().toISOString()}] /practice-test [${subject}]`);
    const persona = PERSONAS[subject] || PERSONAS.Other;
    const model   = getModel('gemini-2.5-flash', practiceTestPrompt(persona, subject, difficulty, numQuestions, questionTypes));

    const parts = [];
    if (contentType === 'files' && files.length > 0) {
      for (const f of files) parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
      parts.push({ text: 'Generate a practice test based on the content in the file(s) above.' });
    } else if (contentType === 'text' && text) {
      parts.push({ text: `Generate a practice test based on:\n\n${text}` });
    } else if (contentType === 'session' && sessionHistory.length > 0) {
      const summary = sessionHistory.map(m => `${m.role==='user'?'Student':'Tutor'}: ${m.content}`).join('\n\n');
      parts.push({ text: `Generate a practice test based on this tutoring session:\n\n${summary}` });
    } else {
      return res.status(400).json({ error: 'No content provided.' });
    }

    let topicText = subject;
    try {
      if (contentType === 'files') {
        topicText = files.map(f=>(f.name||'').replace(/\.[^.]+$/,'').replace(/[-_]/g,' ').trim()).filter(Boolean).slice(0,2).join(' & ') || subject;
      } else {
        const prompt = contentType === 'session'
          ? `In 3-5 words, what topic did this tutoring session cover? Topic only.\n\n${sessionHistory.slice(-6).map(m=>m.content).join(' ')}`
          : `In 3-5 words, what topic does this content cover? Topic only.\n\n${text.slice(0,600)}`;
        topicText = getText(await getModel('gemini-2.0-flash').generateContent({ contents: [{ role:'user', parts:[{ text: prompt }] }] })).trim().replace(/\.$/, '') || subject;
      }
    } catch (_) {}

    const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
    const testMd = getText(result);
    res.json({ test: testMd, title: `Practice Test — ${topicText}`, subject });
  } catch (err) {
    console.error('Practice test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /summarize ───────────────────────────────────────────────────────────

app.post('/summarize', async (req, res) => {
  const { sessionHistory=[], subject='Other', subjects=null, title='Chat Session' } = req.body;
  if (!sessionHistory.length) return res.status(400).json({ error: 'No session history.' });
  try {
    const persona    = (subjects?.length > 1) ? PERSONAS.Other : (PERSONAS[subject] || PERSONAS.Other);
    const model      = getModel('gemini-2.5-flash', summarizePrompt(persona, subject, subjects));
    const transcript = sessionHistory.map(m=>`${m.role==='user'?'Student':'Tutor'}: ${m.content}`).join('\n\n');
    const result     = await model.generateContent({ contents: [{ role:'user', parts:[{ text:`Summarize this tutoring session:\n\n${transcript}` }] }] });
    res.json({ summary: getText(result), title: `Summary — ${title}` });
  } catch (err) {
    console.error('Summarize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /flashcards ──────────────────────────────────────────────────────────

app.post('/flashcards', async (req, res) => {
  const { sessionHistory=[], subject='Other', title='Chat Session' } = req.body;
  if (!sessionHistory.length) return res.status(400).json({ error: 'No session history.' });
  try {
    const persona    = PERSONAS[subject] || PERSONAS.Other;
    const model      = getModel('gemini-2.5-flash', flashcardsPrompt(persona, subject));
    const transcript = sessionHistory.map(m=>`${m.role==='user'?'Student':'Tutor'}: ${m.content}`).join('\n\n');
    const result     = await model.generateContent({ contents: [{ role:'user', parts:[{ text:`Generate flashcards for this tutoring session:\n\n${transcript}` }] }] });
    const raw        = getText(result).trim().replace(/^```json|^```|```$/gm,'').trim();
    let cards;
    try {
      cards = JSON.parse(raw);
      if (!Array.isArray(cards)) throw new Error('Not an array');
      cards = cards.slice(0, 15);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse flashcards.' });
    }
    res.json({ cards, title: `Flashcards — ${title}` });
  } catch (err) {
    console.error('Flashcards error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── WebSocket /live — Gemini Live API proxy ───────────────────────────────────

const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer, path: '/live' });

wss.on('connection', (browserWs) => {
  console.log(`[${new Date().toISOString()}] Live session opened`);

  if (!LIVE_API_KEY) {
    browserWs.send(JSON.stringify({ type: 'error', error: 'Live API key not loaded.' }));
    browserWs.close();
    return;
  }

  const LIVE_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${LIVE_API_KEY}`;
  const geminiWs = new WebSocket(LIVE_URL);
  let setupSent  = false;

  browserWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'setup') {
        const subject        = msg.subject || 'Other';
        const persona        = PERSONAS[subject] || PERSONAS.Other;
        const isFirstSession = msg.isFirstSession !== false;
        const voiceName      = msg.voice || 'Aoede';
        console.log(` -> Live: subject=${subject}, voice=${voiceName}`);

        const setupPayload = {
          setup: {
            model: `models/${LIVE_MODEL}`,
            generation_config: {
              response_modalities: ['AUDIO'],
              speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } },
            },
            output_audio_transcription: {},
            input_audio_transcription:  {},
            system_instruction: { parts: [{ text: liveVoiceSystemPrompt(persona, isFirstSession) }] },
          },
        };

        if (geminiWs.readyState === WebSocket.OPEN) { geminiWs.send(JSON.stringify(setupPayload)); setupSent = true; }
        else geminiWs.once('open', () => { geminiWs.send(JSON.stringify(setupPayload)); setupSent = true; });
        return;
      }

      if (!setupSent) return;

      if (msg.type === 'audio') {
        geminiWs.readyState === WebSocket.OPEN && geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ mime_type: msg.mime||'audio/pcm;rate=16000', data: msg.data }] } }));
      } else if (msg.type === 'video') {
        geminiWs.readyState === WebSocket.OPEN && geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ mime_type: 'image/jpeg', data: msg.data }] } }));
      } else if (msg.type === 'text') {
        geminiWs.readyState === WebSocket.OPEN && geminiWs.send(JSON.stringify({ client_content: { turns: [{ role: 'user', parts: [{ text: msg.text }] }], turn_complete: true } }));
      } else if (msg.type === 'end_turn' || msg.type === 'interrupt') {
        geminiWs.readyState === WebSocket.OPEN && geminiWs.send(JSON.stringify({ client_content: { turn_complete: true } }));
      }
    } catch (e) { console.error('Live parse error:', e.message); }
  });

  geminiWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.setupComplete) { browserWs.send(JSON.stringify({ type: 'ready' })); return; }
      const parts = msg.serverContent?.modelTurn?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData?.data) browserWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data, mime: part.inlineData.mimeType||'audio/pcm;rate=24000' }));
          if (part.text) browserWs.send(JSON.stringify({ type: 'text', text: part.text }));
        }
      }
      const outT = msg.serverContent?.outputTranscription?.text;
      if (outT) browserWs.send(JSON.stringify({ type: 'transcript_out', text: outT }));
      const inT = msg.serverContent?.inputTranscription?.text;
      if (inT)  browserWs.send(JSON.stringify({ type: 'transcript_in',  text: inT }));
      if (msg.serverContent?.turnComplete) browserWs.send(JSON.stringify({ type: 'turn_complete' }));
      if (msg.serverContent?.interrupted)  browserWs.send(JSON.stringify({ type: 'interrupted' }));
    } catch (e) { console.error('Live Gemini parse error:', e.message); }
  });

  geminiWs.on('error', (err) => { console.error('Live Gemini WS error:', err.message); browserWs.send(JSON.stringify({ type: 'error', error: err.message })); });
  geminiWs.on('close', (code) => { console.log(`Gemini WS closed: ${code}`); if (browserWs.readyState === WebSocket.OPEN) browserWs.close(); });
  browserWs.on('close', () => { if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
  browserWs.on('error', (e) => console.error('Live browser WS error:', e.message));
});

// ── Start ─────────────────────────────────────────────────────────────────────

await loadLiveApiKey();

httpServer.listen(PORT, () => {
  console.log(`Mentora backend on http://localhost:${PORT}`);
  console.log(`  GET  /health        — status`);
  console.log(`  POST /analyze       — Vertex AI streaming`);
  console.log(`  POST /chat          — Vertex AI streaming`);
  console.log(`  POST /practice-test — Vertex AI`);
  console.log(`  POST /summarize     — Vertex AI`);
  console.log(`  POST /flashcards    — Vertex AI`);
  console.log(`  WS   /live          — Gemini Live (Secret Manager key)\n`);
});