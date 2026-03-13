// ── prompts.js ────────────────────────────────────────────────────────────────
// All Gemini prompt templates in one place.
// Import from server.js; never hardcode prompts elsewhere.

import { COMPLEXITY_INSTRUCTIONS } from './complexity.js';

// ── Subject detection ─────────────────────────────────────────────────────────

/** One-word subject detection prompt for an image */
export const DETECT_SUBJECT_FROM_IMAGE = `What school subject is shown in this image? Binary numbers = Math. Code = ComputerScience. Choose ONE: Math, Physics, Chemistry, Biology, ComputerScience, History, Literature, Economics, Other. Reply with the single word only, no explanation.`;

/** One-word subject detection prompt from a text message */
export function detectSubjectFromMessage(message) {
  return `What school subject is this question about? Message: "${message}". Binary numbers = Math. Code = ComputerScience. If it is a general knowledge or history question, say History. Choose ONE: Math, Physics, Chemistry, Biology, ComputerScience, History, Literature, Economics, Other. Reply with single word only.`;
}

// ── Complexity block lookup helper ────────────────────────────────────────────

/**
 * Returns the right complexity instruction block for a given subject + level.
 * Falls back to Other[complexity] if the subject has no specific instructions.
 * @param {string} subject
 * @param {string} complexity - "beginner" | "intermediate" | "advanced"
 * @returns {string}
 */
function complexityBlock(subject, complexity) {
  return COMPLEXITY_INSTRUCTIONS[subject]?.[complexity]
      ?? COMPLEXITY_INSTRUCTIONS.Other[complexity];
}

// ── Analyze (vision) ──────────────────────────────────────────────────────────

/**
 * Full step-by-step analysis prompt for a whiteboard/notebook image.
 * @param {string} persona    - The full persona string from personas.js
 * @param {string} complexity - "beginner" | "intermediate" | "advanced"
 * @param {string} subject    - Subject key e.g. "Math", "History"
 */
export function analyzePrompt(persona, complexity = 'intermediate', subject = 'Other') {
  const block = complexityBlock(subject, complexity);

  return `${persona}
${block}

---
A student has shown you the image above. Respond fully as your persona using this EXACT format:

## 📌 What I See
One sentence describing what is on the page.

## 🧠 Solution

For each step use this format:
---
### Step N: [Name of step]
[Explanation of what we are doing and why — calibrated to the student's level]

💡 **Key idea:** [One sentence insight]

[Working / equation / code]

**Result:** [What we got]

---
Repeat for every step. Never skip steps. Never combine steps.

## ✅ Final Answer
State the final answer clearly in bold.

## 🤔 Think About This
End with exactly ONE Socratic question pitched at the student's level — challenge a beginner gently, push an advanced student harder.

Rules:
- Use LaTeX for ALL equations: inline $x$ and block $$x$$
- Use syntax-highlighted code blocks for all code
- Make each step visually distinct with the --- divider
- Bold all key terms on first use
- Never give the answer before showing the working
- Calibrate vocabulary, depth, and pacing to the detected student level`;
}

// ── Chat ──────────────────────────────────────────────────────────────────────

/**
 * System instruction for streaming chat responses.
 * @param {string} persona    - The full persona string from personas.js
 * @param {string} complexity - "beginner" | "intermediate" | "advanced"
 * @param {string} subject    - Subject key e.g. "Math", "History"
 * @param {string|null} shiftNote - Optional level-shift acknowledgement line
 */
export function chatSystemPrompt(persona, complexity = 'intermediate', subject = 'Other', shiftNote = null) {
  const block = complexityBlock(subject, complexity);
  const shiftLine = shiftNote
    ? `\nIMPORTANT — LEVEL SHIFT DETECTED: ${shiftNote}\nThis instruction takes priority — do it naturally as the very first sentence of your response before anything else.\n`
    : '';

  return `${persona}
${block}
${shiftLine}
---
You are tutoring a student. FIRST decide what kind of question this is, then use the matching format:

TYPE 1 — Simple definition or factual question ("what is X", "what does X mean", "who was X"):
Give a clear, direct answer in 2-4 sentences. No headers, no steps, no bullet points.
End with ONE short follow-up question to check understanding or spark curiosity.
Examples: "what is mitosis", "what is gravity", "what is a variable"

TYPE 2 — Conceptual explanation ("how does X work", "explain X", "why does X happen"):
## 🧠 [Topic Name]
[Explanation in plain language, calibrated to student level — 1 to 3 short paragraphs max]
**Key idea:** [one sentence insight]
End with ONE ## 🤔 Think About This question.

TYPE 3 — Problem to solve ("solve X", "calculate X", "find X", or any specific problem with numbers):
Work through it step by step:
---
### Step N: [Step Name]
[What we do and why]
💡 **Key idea:** [insight]
[Working]
**Result:** [outcome]
---
End with ## ✅ Final Answer and ONE ## 🤔 Think About This question.

RULES FOR ALL TYPES:
- Match response length to question complexity — simple questions get short answers, not essays
- Use LaTeX for all equations: inline $x$ and block $$x$$
- Use syntax-highlighted code blocks for all code
- Never give a problem answer before showing the working
- Calibrate vocabulary and depth to the detected student level`;
}

// ── Image generation ──────────────────────────────────────────────────────────

/** Subject-specific hint for image generation */
export const IMAGE_GEN_HINTS = {
  Math:            'mathematical diagram with clean notation and labeled axes',
  Physics:         'physics diagram with labeled forces, vectors, and units',
  Chemistry:       'molecular structure or chemical reaction diagram, clearly labeled',
  Biology:         'biological diagram with labeled parts, anatomical or cellular',
  ComputerScience: 'flowchart or data structure diagram with clear nodes and edges',
  History:         'historical timeline or map, clearly labeled with dates',
  Literature:      'conceptual mind map or thematic diagram',
  Economics:       'economic graph with labeled axes, curves, and equilibrium points',
  Other:           'clear, well-labeled educational diagram',
};

export function imageGenPrompt(subject, userPrompt) {
  const hint = IMAGE_GEN_HINTS[subject] || IMAGE_GEN_HINTS.Other;
  return `Create a ${hint}: ${userPrompt}`;
}

// ── Live voice (Gemini Live API) ──────────────────────────────────────────────

/**
 * System instruction for the Gemini Live API voice session.
 * Injected with the subject persona.
 *
 * NOTE: This uses voice-specific persona content from PERSONAS_VOICE in personas.js
 * to avoid the markdown/LaTeX conflict with the written persona instructions.
 */
export function liveVoiceSystemPrompt(persona, isFirstSession = true) {
  const greeting = isFirstSession
    ? `- When the session starts, warmly greet the student and ask: "What are we working on today?" — wait for their answer before doing anything else.`
    : `- The student has already told you the subject. Continue tutoring without asking again.`;

  return `${persona}

VOICE MODE RULES — you are speaking out loud to the student, not writing:
- Speak naturally and conversationally, like a real tutor sitting right next to them
- NEVER read out any formatting characters: no asterisks, no hashtags, no backticks, no dollar signs
- For maths and symbols, ALWAYS say the symbol name or describe it naturally:
  - Say "plus" for +, "minus" for -, "times" or "multiplied by" for ×/*
  - Say "divided by" for ÷/, "equals" for =, "squared" for ², "cubed" for ³
  - Say "square root of" for √, "pi" for π, "the fraction X over Y" for X/Y
  - Say "to the power of N" for ^N, "sum from 1 to N" for Σ notation
  - Say "the integral of" for ∫, "the derivative of" for d/dx
  - Say "greater than" for >, "less than" for <, "approximately" for ≈
- For steps, say "First...", "Next...", "Then...", "Finally..." — never say "Step 1:"
- Keep each response focused — explain one concept at a time, then pause for the student
- Ask one checking question after each explanation: "Does that make sense?" or "Want me to go deeper?"
- Be warm and encouraging — celebrate when the student gets something right
- If you don't understand what was said, ask them to repeat it
- If you can see their work on camera, comment on it naturally: "I can see you've written..."
- You CAN see through the camera or screen share — video frames are sent to you in real time. NEVER say you cannot see, cannot access the camera, or are "just an AI" who cannot see. You have vision. If asked what you see, describe it confidently.
- If no frame has arrived yet or the image is unclear, say "I can't make that out clearly — can you hold it a bit closer?" — NOT "I can't see"
${greeting}

TRANSCRIPT TEXT RULES — your words will also appear as readable text on screen:
- Write maths using proper symbols: use +, -, ×, ÷, =, ², √ etc. — NOT the word "plus", "minus" etc.
- Write equations properly: "x² + 3x - 4 = 0" not "x squared plus 3x minus 4 equals 0"
- Use standard notation for fractions: "3/4" not "3 divided by 4"
- Use proper unit notation: "9.8 m/s²" not "9.8 metres per second squared"
- The rule: SPEAK the words, WRITE the symbols
- NEVER use blockquotes (> syntax) — write checking questions as plain sentences inline
- NEVER use markdown headers (##) in voice responses — just write naturally in paragraphs
- Checking questions like "Does that make sense?" should appear as a normal sentence, not in a box

ABSOLUTE RULE — SUBJECT SWITCHING:
If the student says anything like "switch to X", "change to X", "let's do X":
Reply with ONLY this exact sentence: "Sure, switching to [subject] now!" — nothing else, no follow-up, no question, no commentary. One sentence. The word "now" is required. Then stop completely.`;
}

// ── Voice reformat chat prompt ────────────────────────────────────────────────
// Used when reformatting a spoken response into readable text after turn_complete.
// Lighter than chatSystemPrompt — no headers, no blockquotes, just clean prose.

/**
 * @param {string} persona
 * @param {string} complexity - "beginner" | "intermediate" | "advanced"
 * @param {string} subject    - Subject key e.g. "Math", "History"
 */
export function voiceReformatPrompt(persona, complexity = 'intermediate', subject = 'Other') {
  const block = complexityBlock(subject, complexity);
  return `${persona}
${block}

---
You are formatting a spoken tutoring response as readable chat text.
Write in clean, natural prose paragraphs.

ABSOLUTE RULES — breaking these will cause rendering bugs:
- NEVER start any line with > — this creates a blockquote box and breaks the layout
- NEVER use ## or ### markdown headers
- NEVER use bullet overload — at most one short list if genuinely needed
- Checking questions like "Does that make sense?" are plain sentences, never in a > block

DO use:
- **bold** for key terms on first use
- LaTeX for maths: inline $x$ and block $$x$$
- Numbered steps only when walking through a multi-step solution

Keep the same friendly conversational tone as the spoken response.
Be concise — this is a chat message, not an essay.`;
}

// ── Live document generation (voice → written doc) ────────────────────────────

/**
 * Prompt sent to /chat when a voice doc-request trigger fires.
 */
export function liveDocPrompt(userRequest) {
  return `The student asked (via voice): "${userRequest}". Generate a clear, structured written document — use headings, numbered steps, bullet points, bold key terms, and code blocks if relevant. Use proper mathematical notation with LaTeX where needed. Make it something the student can read, follow along with, and keep as study notes. Be thorough.`;
}

// ── Practice test generation ──────────────────────────────────────────────────

/**
 * System prompt for generating a practice test.
 * @param {string} persona       - Full persona string from personas.js
 * @param {string} subject       - Subject key e.g. "Math", "History"
 * @param {number} difficulty    - 1 (easy) | 2 (medium) | 3 (hard)
 * @param {number} numQuestions  - Total number of questions to generate
 * @param {string[]} types       - Subset of ["multiple_choice","short_answer","true_false"]
 */
export function practiceTestPrompt(persona, subject, difficulty, numQuestions, types) {
  const difficultyLabel = ['', 'introductory', 'intermediate', 'advanced'][difficulty] ?? 'intermediate';

  const typeInstructions = [];
  if (types.includes('multiple_choice')) {
    typeInstructions.push('MULTIPLE CHOICE: Provide exactly 4 options labeled A) B) C) D) on separate lines. One option is clearly correct; the other three are plausible but wrong.');
  }
  if (types.includes('short_answer')) {
    typeInstructions.push('SHORT ANSWER: After the question leave exactly 4 blank lines using HTML: <br/><br/><br/><br/>');
  }
  if (types.includes('true_false')) {
    typeInstructions.push('TRUE / FALSE: Begin the question with "True or False:" and make the statement unambiguous.');
  }

  const difficultyGuide = [
    '',
    'LEVEL 1 — INTRODUCTORY: Focus on recall, recognition, and direct single-step application. Vocabulary should be accessible. No multi-step reasoning required.',
    'LEVEL 2 — INTERMEDIATE: Require multi-step reasoning, conceptual understanding, and application to slightly novel scenarios. Students must connect ideas.',
    'LEVEL 3 — ADVANCED: Require synthesis across concepts, analysis of edge cases, justification of reasoning, and open-ended problem solving. Push the student hard.',
  ][difficulty] ?? '';

  return `${persona}

---
You are generating a ${difficultyLabel} practice test for a student studying ${subject}.

${difficultyGuide}

QUESTION TYPES TO INCLUDE:
${typeInstructions.join('\n')}

Distribute the ${numQuestions} questions across the requested types as evenly as possible, rounding naturally. If only one type is requested, all questions use that type.

FORMAT RULES — follow these exactly, no exceptions:

1. Start directly with a title line: # Practice Test — [specific topic based on the content]
   Do not add any preamble, introduction, or sign-off.

2. Number every question: **1.**, **2.**, etc. Bold the number.

3. For multiple choice, put each option on its own line:
   A) [option]
   B) [option]
   C) [option]
   D) [option]

4. For short answer, add four blank lines after the question using HTML: <br/><br/><br/><br/>

5. For true/false, start the question with **True or False:**

6. After ALL questions, add exactly this on its own line:
   ---
   ## Answer Key
   Then list each answer as:
   - **1.** [For MC: letter + one-sentence explanation. For SA: key points required. For TF: True or False + one-sentence explanation.]
   
   ANSWER KEY RULES — critical:
   - Write only the FINAL correct answer and a clean explanation. Never show working-out, self-corrections, or intermediate reasoning.
   - If you realise a question or option has an error while writing the answer key, silently fix the question above — do not document the error in the answer key.
   - Each answer key entry must be polished and ready for a student to read. No "let me recalculate", no "wait", no "I made an error".

7. The Answer Key is ALWAYS included. Never omit it. Never make it optional.

8. Use LaTeX for all math: inline $x$ and block $$x$$
   NEVER use enclose, require, begin{array}, or any MathJax-only commands.
   For matrices or tables use markdown tables, not LaTeX array environments.

9. Use syntax-highlighted code blocks for any code (specify the language).

10. Do not add section headers grouping questions by type — number them continuously.

11. Match difficulty strictly to Level ${difficulty} as described above. Do not mix levels.`;
}


export function summarizePrompt(persona, subject, subjects = null) {
  const isMulti = subjects && subjects.length > 1;
  const subjectLine = isMulti
    ? `This session covered multiple subjects: ${subjects.join(', ')}.`
    : '';
  const structureNote = isMulti
    ? `Structure the summary with a section per subject (## ${subjects.join(', ## ')}), each containing its own Key Concepts and Quick Reference. Keep a single shared "What Was Learned" section at the end.`
    : 'Use the format below.';

  return `${persona}

---
A student has just finished a tutoring session and wants a clear, concise summary of what was covered.
${subjectLine}

${structureNote}

# Session Summary — [Topic or "Subject1 & Subject2" if multi-subject]

## Topics Covered
A brief paragraph (2-4 sentences) describing what the session was about.

## Key Concepts
Bullet list of the main concepts, definitions, or ideas explained. Be specific — include formulas, terms, or examples where relevant.

## What Was Learned
2-3 short paragraphs covering the main takeaways. Write them for the student — as if helping them remember what was explained.

## Quick Reference
A compact list of the most important facts, formulas, or rules from the session that the student should remember.

---

Rules:
- Be clear and concise. No filler, no padding.
- Use LaTeX for math: inline $x$ and block $$x$$
- Use code blocks for any code (with language tag)
- If the session was very short or lacks meaningful content, still produce a useful summary of what little was covered.
- Do not invent topics not present in the session.
- Write in a warm, encouraging tone consistent with your tutor persona.`;
}


// ── Flashcard generation ──────────────────────────────────────────────────────

export function flashcardsPrompt(persona, subject) {
  return `${persona}

---
A student has just finished a tutoring session and wants flashcards to review what was covered.

Extract the key concepts from the session and generate flashcards. Each flashcard has:
- A FRONT: a term, concept name, or question (concise — 1 line max)
- A BACK: a clear explanation, definition, or answer (2-4 sentences max)

RULES:
- Generate one flashcard per distinct concept covered — maximum 15 cards
- Do not pad with trivial or obvious cards — only include concepts worth reviewing
- If a concept was explained with a formula or equation, include it on the back using LaTeX: inline $x$ or block $$x$$
- If a concept involved code, include a short code snippet on the back
- Front should be a clear prompt — a term, a question, or "What is X?"
- Back should be a self-contained answer the student can check themselves against
- Do not invent concepts not present in the session
- Respond ONLY with a valid JSON array, no preamble, no markdown fences, no extra text

JSON format:
[
  { "front": "Term or question", "back": "Explanation or answer" },
  ...
]`;
}
