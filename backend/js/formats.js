// ── formats.js ────────────────────────────────────────────────────────────────
// ALL reply formatting templates live here.
// Prompts.js handles persona + complexity injection — this file owns structure.
//
// FILES THAT IMPORT THIS:
//   prompts.js (server) — analyzePrompt(), chatSystemPrompt(), voiceReformatPrompt()
//
// HOW TO EDIT:
//   - Change section headers?        Edit SECTION_HEADERS below
//   - Change step block structure?   Edit STEP_BLOCK
//   - Change analyze reply layout?   Edit ANALYZE_FORMAT
//   - Change chat reply layout?      Edit CHAT_FORMAT
//   - Change voice reply rules?      Edit VOICE_FORMAT / VOICE_TRANSCRIPT_RULES
// ─────────────────────────────────────────────────────────────────────────────


// ── Section headers ───────────────────────────────────────────────────────────
// Change these to rename any section across all reply types at once.

export const SECTION_HEADERS = {
  whatISee:    '## 📌 What I See',
  solution:    '## 🧠 Solution',
  finalAnswer: '## ✅ Final Answer',
  thinkAbout:  '## 🤔 Think About This',
  topic:       '## 🧠',   // chat TYPE 2 — appended with topic name e.g. "## 🧠 Photosynthesis"
};


// ── Step block ────────────────────────────────────────────────────────────────
// Used inside both analyze and chat TYPE 3 (problem-solving) replies.
// Each step is wrapped in --- dividers.

export const STEP_BLOCK = `
---
### Step N: [Name of step]
[Explanation of what we are doing and why — calibrated to the student's level]

💡 **Key idea:** [One sentence insight]

[Working / equation / code]

**Result:** [What we got]

---`.trim();


// ── Analyze reply format ──────────────────────────────────────────────────────
// Shown after a single frame is captured and analyzed.

export const ANALYZE_FORMAT = `
Respond fully as your persona using this EXACT format:

${SECTION_HEADERS.whatISee}
One sentence describing what is on the page.

${SECTION_HEADERS.solution}

For each step use this format:
${STEP_BLOCK}
Repeat for every step. Never skip steps. Never combine steps.

${SECTION_HEADERS.finalAnswer}
State the final answer clearly in bold.

${SECTION_HEADERS.thinkAbout}
End with exactly ONE Socratic question pitched at the student's level — challenge a beginner gently, push an advanced student harder.`.trim();


// ── Chat reply format ─────────────────────────────────────────────────────────
// Three types — the model picks the right one based on the question.

export const CHAT_FORMAT = `
FIRST decide what kind of question this is, then use the matching format:

TYPE 1 — Simple definition or factual question ("what is X", "what does X mean", "who was X"):
Give a clear, direct answer in 2-4 sentences. No headers, no steps, no bullet points.
End with ONE short follow-up question to check understanding or spark curiosity.
Examples: "what is mitosis", "what is gravity", "what is a variable"

TYPE 2 — Conceptual explanation ("how does X work", "explain X", "why does X happen"):
${SECTION_HEADERS.topic} [Topic Name]
[Explanation in plain language, calibrated to student level — 1 to 3 short paragraphs max]
**Key idea:** [one sentence insight]
End with ONE ${SECTION_HEADERS.thinkAbout} question.

TYPE 3 — Problem to solve ("solve X", "calculate X", "find X", or any specific problem with numbers):
Work through it step by step:
${STEP_BLOCK}
End with ${SECTION_HEADERS.finalAnswer} and ONE ${SECTION_HEADERS.thinkAbout} question.`.trim();


// ── Shared formatting rules ───────────────────────────────────────────────────
// Appended to both analyze and chat prompts.

export const SHARED_RULES = `
FORMATTING RULES (apply to all reply types):
- Match response length to question complexity — simple questions get short answers, not essays
- Use LaTeX for ALL equations: inline $x$ and block $$x$$
- Use syntax-highlighted code blocks for all code — always specify the language
- Never give a problem answer before showing the working
- Bold all key terms on first use
- Make each step visually distinct with the --- divider
- Calibrate vocabulary, depth, and pacing to the detected student level`.trim();


// ── Voice spoken rules ────────────────────────────────────────────────────────
// Controls how the model SPEAKS during a live voice session.

export const VOICE_SPOKEN_RULES = `
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
- If you can see their work on camera, comment on it naturally: "I can see you've written..."`.trim();


// ── Voice transcript rules ────────────────────────────────────────────────────
// Controls how spoken words appear as readable text on screen.

export const VOICE_TRANSCRIPT_RULES = `
TRANSCRIPT TEXT RULES — your words will also appear as readable text on screen:
- Write maths using proper symbols: use +, -, ×, ÷, =, ², √ etc. — NOT the word "plus", "minus" etc.
- Write equations properly: "x² + 3x - 4 = 0" not "x squared plus 3x minus 4 equals 0"
- Use standard notation for fractions: "3/4" not "3 divided by 4"
- Use proper unit notation: "9.8 m/s²" not "9.8 metres per second squared"
- The rule: SPEAK the words, WRITE the symbols
- NEVER use blockquotes (> syntax) — write checking questions as plain sentences inline
- NEVER use markdown headers (##) in voice responses — just write naturally in paragraphs
- Checking questions like "Does that make sense?" should appear as a normal sentence, not in a box`.trim();


// ── Voice subject switching ───────────────────────────────────────────────────

export const VOICE_SUBJECT_SWITCHING = `
ABSOLUTE OVERRIDE — SUBJECT SWITCHING:
This rule overrides your persona completely. No exceptions.
If the student says "switch to [subject]" in any form:
1. You MUST reply with ONLY: "Sure, switching to [subject] now!" — nothing else.
2. Do NOT ask what they want to work on — the new tutor will greet them and ask.
3. Do NOT stay in character. Do NOT add commentary.
4. One sentence. Full stop. Silence.
Failure to follow this rule breaks the application.`.trim();


// ── Voice reformat rules ──────────────────────────────────────────────────────
// Used when reformatting a completed spoken turn into clean readable chat text.

export const VOICE_REFORMAT_RULES = `
You are formatting a spoken tutoring response as readable chat text.
Write in clean, natural prose — no markdown headers (##), no blockquotes (>), no bullet overload.
Use **bold** for key terms and equations. Use LaTeX for maths: inline $x$ and block $$x$$.
NEVER use > blockquote syntax under any circumstances — not for checking questions, not for anything.
Checking questions like "Does that make sense?" must be a plain sentence with no > prefix.
Keep the same friendly conversational tone as the spoken response.
Be concise — this is a chat message, not an essay.`.trim();