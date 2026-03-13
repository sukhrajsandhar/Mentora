// ── complexity.js ─────────────────────────────────────────────────────────────
// All complexity/difficulty detection logic in one place.
//
// BACKEND (server.js):
//   import { DETECT_COMPLEXITY_FROM_IMAGE, detectComplexityFromMessage,
//            detectComplexityFromText, shouldReassess, getLevelShiftNote,
//            COMPLEXITY_INSTRUCTIONS } from './complexity.js';
//
// PROMPTS (prompts.js):
//   import { COMPLEXITY_INSTRUCTIONS } from './complexity.js';
//   (used inside analyzePrompt() and chatSystemPrompt())
// ─────────────────────────────────────────────────────────────────────────────

// ── Detection prompts (sent to Gemini) ───────────────────────────────────────

/**
 * Assess complexity from an image.
 * Returns one of: "beginner" | "intermediate" | "advanced"
 */
export const DETECT_COMPLEXITY_FROM_IMAGE = `Look at this image of a student's work and classify the complexity level:

BEGINNER: basic arithmetic, simple fractions, early algebra, basic science diagrams, primary/middle school content
INTERMEDIATE: high school algebra/geometry, balanced equations, circuit diagrams, essay-level writing
ADVANCED: calculus, university-level physics/chemistry, complex algorithms, formal proofs

Priority rules:
- Any proof, derivation, or formal theorem → always advanced
- Single-digit arithmetic or times tables → always beginner
- Errors on simple material suggest beginner even if the topic looks harder
- Only default to beginner when the signal is genuinely ambiguous

Reply with ONE word only: beginner, intermediate, or advanced`;

/**
 * Assess complexity from a text message + conversation history.
 *
 * On first message (no history): classifies the message itself.
 * On reassessment turns (history present): looks at the student's trajectory —
 * separating confidence (how they sound) from competence (how they actually perform).
 *
 * Returns one of: "beginner" | "intermediate" | "advanced"
 */
export function detectComplexityFromMessage(message, history = []) {
  // ── First message — no history yet, classify the message itself ──────────
  if (!history.length) {
    return `Student message: "${message}"

Classify the student level. Use these rules strictly:

BEGINNER — clear signals:
- Basic arithmetic, times tables, simple fractions, percentages
- "what is X" questions about foundational concepts
- Primary or early secondary school content
- Very informal phrasing showing genuine uncertainty about basics

INTERMEDIATE — clear signals:
- Multi-step algebra, quadratics, simultaneous equations
- High school science: forces, reactions, genetics, circuits
- Student knows and uses terminology correctly at a high school level

ADVANCED — clear signals:
- Any request for a proof or derivation → always advanced
- Calculus, university-level physics, organic chemistry, algorithms
- Precise technical jargon used correctly
- Questions about theory, edge cases, or rigorous reasoning

Priority rules — these override everything else:
- "prove that..." or "derive..." or "show that..." → always advanced
- Single-digit arithmetic or times tables → always beginner
- Only default to beginner when the signal is genuinely ambiguous

Reply with ONE word only: beginner, intermediate, or advanced`;
  }

  // ── Rolling reassessment — separate confidence from competence ────────────
  // Use the last 8 messages (4 exchanges) to judge progress or struggle.
  const recentHistory = history.slice(-8);
  const historySnippet = recentHistory
    .map(h => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${h.content}`)
    .join('\n');

  return `You are assessing a student's level based on how a tutoring session has gone so far.

Recent conversation:
${historySnippet}

Student's latest message: "${message}"

Classify the student's current level by examining TWO signals independently:

SIGNAL 1 — COMPETENCE (what they actually do):
- Are their answers correct or nearly correct?
- Are they applying concepts properly, even if hesitantly?
- Are they making the same errors repeatedly despite being corrected?
- Are they asking questions that show they understood the previous explanation?

SIGNAL 2 — CONFIDENCE (how they sound):
- Do they use uncertain language: "i think", "maybe", "is it...?", "not sure but..."?
- Do they sound overconfident but keep getting things wrong?
- NOTE: a shy student who keeps getting things right is NOT a beginner.
- NOTE: a confident student who keeps making errors is NOT advanced.

ALWAYS weight competence over confidence. A student who says "i think it might be x²+2x?"
and is correct should be treated as intermediate or advanced, not beginner.

STEP DOWN to BEGINNER if:
- Repeated errors on foundational material even after explanation
- Genuine confusion about core terms or steps across multiple exchanges
- Short panicked responses suggesting they are completely lost

KEEP or MOVE UP to INTERMEDIATE if:
- Getting things mostly right, even if uncertain in phrasing
- Following along and building on previous explanations
- Vocabulary and accuracy improving across the session

MOVE UP to ADVANCED if:
- Consistently correct, asking about edge cases, theory, or extensions
- Pushing back on or extending the tutor's explanations appropriately
- Has clearly already grasped the core material and wants to go deeper

Prefer stability — only change level if there is clear evidence across multiple
exchanges. A single hard question does not make someone advanced.
A single confused message does not make someone a beginner.

Reply with ONE word only: beginner, intermediate, or advanced`;
}

// ── Hard override pre-check ───────────────────────────────────────────────────
// Run this BEFORE calling Gemini. If it returns a level, use it directly and
// skip the Gemini call entirely — these rules must never be overridden by history.

const ALWAYS_ADVANCED = [
  /\bprove\s+that\b/i,
  /\bprove\b/i,
  /\bderive\b/i,
  /\bderivation\b/i,
  /\bshow\s+that\b/i,
  /\bformal\s+proof\b/i,
];

const ALWAYS_BEGINNER = [
  /^\s*\d\s*[×x\*]\s*\d\s*$/,           // "7 x 8", "3 * 4"
  /^what\s+is\s+\d+\s*[×x\*]\s*\d+/i,   // "what is 7 times 8"
  /\btimes\s+table/i,
];

/**
 * Returns a forced complexity level if the message matches a hard override rule.
 * Returns null if no override applies — proceed with Gemini detection as normal.
 * @param {string} message
 * @returns {'beginner'|'advanced'|null}
 */
export function hardComplexityOverride(message) {
  if (ALWAYS_ADVANCED.some(re => re.test(message))) return 'advanced';
  if (ALWAYS_BEGINNER.some(re => re.test(message))) return 'beginner';
  return null;
}

// ── Rolling reassessment gate ─────────────────────────────────────────────────

/**
 * Returns true if this turn should trigger a full complexity re-assessment.
 * Turn 0 is skipped (streams immediately at intermediate).
 * Every turn after that is reassessed.
 *
 * @param {number} turnCount - Number of completed student turns so far (0-indexed)
 * @returns {boolean}
 */
export function shouldReassess(turnCount) {
  return turnCount > 0; // skip turn 0, reassess every turn after that
}

// ── Level shift acknowledgement ───────────────────────────────────────────────

/**
 * Returns a subtle one-line instruction to weave into the prompt when the
 * detected complexity has changed from the previous turn.
 * Returns null if no shift occurred.
 *
 * @param {string|null} previousLevel - The last known complexity level
 * @param {string} newLevel - The newly detected complexity level
 * @returns {string|null}
 */
export function getLevelShiftNote(previousLevel, newLevel) {
  if (!previousLevel || previousLevel === newLevel) return null;

  const shifts = {
    // stepping up
    'beginner->intermediate': `The student has just shown they are ready for more — naturally and briefly acknowledge their progress before continuing (e.g. "you're getting the hang of this").`,
    'beginner->advanced':     `The student has shown a strong grasp — naturally and briefly note that you'll pick up the pace before continuing.`,
    'intermediate->advanced': `The student is clearly ahead — naturally and briefly acknowledge this before continuing (e.g. "you've clearly got this, let's go deeper").`,
    // stepping down
    'intermediate->beginner': `The student seems to be struggling — naturally and briefly offer reassurance before slowing down (e.g. "let's take a step back and make sure this is solid").`,
    'advanced->intermediate': `The student has hit a tricky patch — naturally and briefly normalise it before continuing (e.g. "this part trips a lot of people up, let's slow down here").`,
    'advanced->beginner':     `The student is lost — gently and briefly acknowledge it before going back to basics (e.g. "no worries, let's build this up from the ground").`,
  };

  const key = `${previousLevel}->${newLevel}`;
  return shifts[key] || null;
}

// ── Response parser (used in server.js) ──────────────────────────────────────

const COMPLEXITY_MAP = {
  'beginner':     'beginner',
  'intermediate': 'intermediate',
  'advanced':     'advanced',
};

/**
 * Parse Gemini's one-word complexity reply.
 * Falls back to 'intermediate' if the response is unrecognised.
 * @param {string} raw - Raw text from Gemini response
 * @returns {'beginner'|'intermediate'|'advanced'}
 */
export function detectComplexityFromText(raw) {
  const firstWord = raw.trim().split(/[\n\r\s,\.;:]+/)[0].toLowerCase();
  return COMPLEXITY_MAP[firstWord] || 'intermediate';
}

// ── Prompt injection blocks (used in prompts.js) ──────────────────────────────
// Subject-aware complexity instructions — every subject has its own set.
// Injected into analyzePrompt() and chatSystemPrompt() via:
//   const complexityBlock = COMPLEXITY_INSTRUCTIONS[subject]?.[complexity]
//                        ?? COMPLEXITY_INSTRUCTIONS.Other[complexity];

export const COMPLEXITY_INSTRUCTIONS = {

  Math: {
    beginner: `
STUDENT LEVEL: BEGINNER — MATHEMATICS
- Use everyday language — avoid symbols until you have explained them in words first
- Never skip arithmetic steps, even obvious ones like "3 × 4 = 12"
- Use physical analogies: fractions as pizza slices, multiplication as rows of seats
- Write every equation on its own line and narrate what each part means
- Celebrate small correct steps — getting the sign right matters
- Check in after every single step: "Does that make sense before we move on?"
- If they get something wrong, ask "what did you get here?" before correcting`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE — MATHEMATICS
- Use correct mathematical vocabulary but briefly define anything advanced
- Work step by step — show all working, but you can combine simple arithmetic
- Prompt them before revealing steps: "What do you think we should do next?"
- Point out common traps: sign errors, forgetting to flip inequality on division
- Connect new techniques to ones they already know: "This is like factoring, but..."
- Encourage them to sanity-check answers: "Does this answer feel reasonable?"`,

    advanced: `
STUDENT LEVEL: ADVANCED — MATHEMATICS
- Use precise mathematical language freely: bijection, convergence, eigenvalue etc.
- You may skip routine algebra but flag it: "skipping the partial fractions here..."
- Engage at near-peer level — discuss elegance, generalisations, alternative proofs
- Push further: "Can you prove this holds for all n?" or "What breaks at the boundary?"
- Point toward deeper theory: real analysis, abstract algebra, topology where relevant
- Be concise — they want insight and challenge, not hand-holding`,
  },

  Physics: {
    beginner: `
STUDENT LEVEL: BEGINNER — PHYSICS
- Always start with the physical intuition before any equation
- Use concrete everyday examples: forces as pushes and pulls, energy as the ability to do work
- Introduce one variable at a time — never show F=ma before explaining what force, mass, and acceleration each mean separately
- Draw everything in words: "imagine an arrow pointing to the right — that is the force"
- Always include units and explain what they mean: "metres per second means how many metres in one second"
- Check in constantly — physics concepts stack and a missed foundation breaks everything`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE — PHYSICS
- Lead with physical intuition, then formalise with equations
- Use correct notation with units always labelled
- Track dimensions obsessively — remind them that checking units catches most errors
- Use thought experiments: "what would happen if we doubled the mass?"
- Connect to real phenomena: circuits to household wiring, waves to sound and light
- Encourage free body diagrams before any calculation`,

    advanced: `
STUDENT LEVEL: ADVANCED — PHYSICS
- Treat them as a near-peer — discuss derivations, limiting cases, and approximations
- Use vector notation, calculus, and field theory freely
- Ask them to derive, not just apply: "can you get this from first principles?"
- Discuss where models break down: when Newtonian mechanics fails, when ideal gas is wrong
- Connect to broader theory: Lagrangians, symmetry, quantum corrections where relevant
- Be concise and precise — they want depth, not repetition`,
  },

  Chemistry: {
    beginner: `
STUDENT LEVEL: BEGINNER — CHEMISTRY
- Anthropomorphise atoms and molecules to make bonding intuitive — sodium "wants" to give away its electron
- Explain every symbol before using it: what H₂O means before writing any formula
- Balance equations one element at a time, narrating every step
- Connect everything to real life immediately: "this is literally what happens when you cook an egg"
- Use colour and state symbols (s), (l), (g), (aq) and explain what they mean
- Never assume they know the periodic table — name the element alongside its symbol`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE — CHEMISTRY
- Use proper chemical notation throughout
- Explain the WHY behind reactions: electronegativity, stability, entropy driving things
- Walk through reaction mechanisms, not just the overall equation
- Connect to real applications: medicines, materials, everyday chemistry
- Name functional groups immediately when you see them
- Encourage them to predict products before you reveal them`,

    advanced: `
STUDENT LEVEL: ADVANCED — CHEMISTRY
- Use IUPAC nomenclature and mechanism notation freely
- Discuss orbital theory, thermodynamic driving forces, and kinetic vs thermodynamic control
- Push toward mechanism prediction: "what would happen with a bulkier nucleophile?"
- Connect to biochemistry and materials science where relevant
- Discuss spectroscopy and how structures are confirmed experimentally
- Be concise — they want mechanistic insight and challenge`,
  },

  Biology: {
    beginner: `
STUDENT LEVEL: BEGINNER — BIOLOGY
- Always zoom out to the big picture before going molecular: "your body needs energy, here is how cells get it"
- Use vivid analogies: mitochondria as power stations, DNA as a recipe book
- Define every technical term the moment you use it — biology is vocabulary-heavy
- Connect everything to the student's own body where possible
- Use process narratives: "picture a ribosome moving along the mRNA like a train on a track"
- Avoid assuming prior knowledge — build from organism → organ → cell → molecule`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE — BIOLOGY
- Use correct terminology with brief reminders of what terms mean
- Connect structure to function always: "the shape of the enzyme matters because..."
- Ask evolutionary questions: "why did this trait evolve? what problem does it solve?"
- Connect to medicine and disease to make concepts concrete
- Walk through processes as narratives but at a faster pace
- Encourage them to predict what happens when something goes wrong`,

    advanced: `
STUDENT LEVEL: ADVANCED — BIOLOGY
- Use precise molecular and cellular terminology freely
- Discuss regulation, feedback loops, and systems-level thinking
- Push toward mechanistic depth: signalling cascades, gene expression networks
- Connect to current research questions and unsolved problems
- Discuss experimental techniques: how do we actually know this?
- Be concise — they want mechanistic depth and intellectual challenge`,
  },

  ComputerScience: {
    beginner: `
STUDENT LEVEL: BEGINNER — COMPUTER SCIENCE
- Never assume any programming knowledge — explain what a variable, function, or loop IS before using one
- Use physical world analogies: a variable as a labelled box, a function as a recipe
- Show code in tiny pieces — one line at a time if needed
- Always predict output together before "running" the code mentally
- Praise good instincts even when the syntax is wrong
- Ask "what do you think this line does?" before explaining it
- Keep language simple — avoid jargon like "instantiate", "iterate", "invoke"`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE — COMPUTER SCIENCE
- Use correct CS vocabulary with light reminders
- Think aloud about algorithm design before writing code: "what's our approach here?"
- Ask about time and space complexity naturally: "how does this scale?"
- Discuss edge cases: empty input, single element, very large n
- Rubber duck debug: "walk me through what happens on this line"
- Distinguish between working code and well-designed code`,

    advanced: `
STUDENT LEVEL: ADVANCED — COMPUTER SCIENCE
- Treat them as a near-peer engineer — discuss trade-offs, design patterns, systems thinking
- Talk Big O as a matter of course, and push toward amortised and average-case analysis
- Ask about correctness proofs, invariants, and failure modes
- Discuss production concerns: concurrency, scaling, fault tolerance
- Push toward optimal solutions and question naive approaches
- Be direct and concise — they want insight and challenge, not syntax explanations`,
  },

  History: {
    beginner: `
STUDENT LEVEL: BEGINNER — HISTORY
- Always tell the human story first, then introduce dates and names
- Put everything in context: never assume they know what came before
- Use present-day comparisons to make distant events feel real
- Explain cause and effect explicitly — do not assume they see the connection
- Keep timelines simple and linear at first — avoid jumping around
- Make historical figures feel human: their motivations, fears, and mistakes`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE — HISTORY
- Use proper historical vocabulary with brief definitions
- Structure explanations as cause → event → consequence → legacy
- Introduce multiple perspectives: who benefited, who suffered, who resisted?
- Challenge presentism gently: "we have to understand them in their context"
- Connect economic, social, and political factors — history is never one-dimensional
- Ask "was this inevitable, or could it have gone differently?"`,

    advanced: `
STUDENT LEVEL: ADVANCED — HISTORY
- Engage with historiography: how have historians disagreed about this?
- Discuss primary sources and their limitations: who wrote this and why?
- Push analytical thinking: causation vs correlation, contingency vs structure
- Introduce theoretical frameworks: Marxist history, postcolonial readings, social history
- Challenge their interpretations: "what evidence would disprove that argument?"
- Be concise — they want analytical depth and interpretive challenge`,
  },

  Literature: {
    beginner: `
STUDENT LEVEL: BEGINNER — LITERATURE
- Always ask "what did YOU notice?" before offering any interpretation
- Explain literary terms simply when you introduce them: "a metaphor is when you say one thing IS another thing"
- Focus on plot and character before theme and symbol
- Use familiar comparisons: "this character is like someone you might know who..."
- Make it feel safe to be wrong — all interpretations are worth exploring
- Keep close reading manageable: one sentence or image at a time`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE — LITERATURE
- Use literary terminology with brief reminders
- Analyse at multiple levels: what happens, what it means, how the writing creates the effect
- Ask about authorial choice: "why do you think the writer used this word here?"
- Connect to historical context: when was this written and what was happening?
- Encourage comparison: "does this remind you of anything else you have read?"
- For essays, give structured feedback: thesis, evidence, analysis`,

    advanced: `
STUDENT LEVEL: ADVANCED — LITERATURE
- Engage with literary theory: psychoanalytic, postcolonial, feminist, structuralist readings
- Discuss intertextuality and the writer's place in a tradition
- Push close reading to the level of syntax, rhythm, and sound
- Challenge their interpretations: "what textual evidence supports that reading?"
- Discuss the limits of interpretation: what the text resists
- Be concise — they want intellectual rigour and challenge`,
  },

  Economics: {
    beginner: `
STUDENT LEVEL: BEGINNER — ECONOMICS
- Start with the real-world phenomenon before any model or graph
- Explain what economics actually is: the study of how people make decisions under scarcity
- Use everyday examples: pricing at a coffee shop, choosing between two jobs
- Introduce graphs slowly — explain both axes before drawing any curves
- Ask "what are the incentives here?" as a repeated framework
- Avoid jargon: say "supply goes up" not "the supply curve shifts right" until they are ready`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE — ECONOMICS
- Use correct economic vocabulary with brief reminders
- Always ask about incentives and second-order effects: "what happens next?"
- Connect micro and macro: individual decisions aggregate into market outcomes
- Use data and graphs — describe them clearly and explain what they show
- Present multiple perspectives fairly: not all economists agree
- Connect to current events: "this is exactly what happened in..."`,

    advanced: `
STUDENT LEVEL: ADVANCED — ECONOMICS
- Use formal economic language freely: elasticity, deadweight loss, Nash equilibrium etc.
- Discuss model assumptions and where they break down
- Push toward mathematical formalism where relevant: utility functions, game theory matrices
- Engage with heterodox perspectives: institutional economics, behavioural economics
- Ask about policy trade-offs: "who benefits and who loses, and how do you weigh that?"
- Be concise — they want analytical depth and the ability to handle ambiguity`,
  },

  Other: {
    beginner: `
STUDENT LEVEL: BEGINNER
- Use very simple, everyday language — no jargon without immediate explanation
- Work through problems extremely slowly, one tiny step at a time
- Use lots of analogies to familiar things (food, sports, everyday objects)
- Be extra encouraging and patient — celebrate every small correct observation
- Always define any technical term the moment you use it
- Keep explanations short and clear — avoid overwhelming them
- Check in frequently: "Does that make sense so far?"`,

    intermediate: `
STUDENT LEVEL: INTERMEDIATE
- Use correct technical vocabulary with brief reminders of what terms mean
- Work step by step but you can combine obvious sub-steps
- Connect new concepts to things they likely already know
- Challenge them a little: "Before I show you — what's your instinct here?"
- Point out common mistakes students make at this level
- Balance explanation with asking them to predict the next step`,

    advanced: `
STUDENT LEVEL: ADVANCED
- Use precise technical language freely — they can handle it
- You can skip obvious steps but flag when you do: "skipping the algebra..."
- Engage at a peer level — discuss nuance, edge cases, and deeper implications
- Challenge them with harder follow-up questions after solving
- Point out connections to more advanced topics they might want to explore
- Be concise — they don't need hand-holding, they need insight`,
  },

};
