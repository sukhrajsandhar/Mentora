// ── subjectMap.js ─────────────────────────────────────────────────────────────
// Maps every subject alias, sub-topic, and common phrase to a main persona key.
//
// Used by:
//   voice.js  — verbal subject switching (transcript detection)
//   server.js — subject detection from image and chat message
//
// HOW TO EXTEND:
//   Add new aliases to the arrays below.
//   The key must match a PERSONAS key in personas.js.
// ─────────────────────────────────────────────────────────────────────────────

export const SUBJECT_ALIASES = {

  Math: [
    'math', 'maths', 'mathematics',
    'algebra', 'geometry', 'trigonometry', 'trig',
    'calculus', 'calc', 'differentiation', 'integration',
    'statistics', 'stats', 'probability',
    'linear algebra', 'matrices', 'vectors',
    'discrete math', 'discrete mathematics', 'combinatorics', 'graph theory',
    'differential equations', 'diff eq', 'odes', 'pdes',
    'applied math', 'applied mathematics', 'number theory',
    'arithmetic', 'fractions', 'percentages', 'decimals',
  ],

  Physics: [
    'physics',
    'mechanics', 'kinematics', 'dynamics', 'statics',
    'electricity', 'magnetism', 'electromagnetism', 'em',
    'thermodynamics', 'heat', 'entropy',
    'optics', 'light', 'waves',
    'quantum', 'quantum physics', 'quantum mechanics',
    'nuclear physics', 'radioactivity',
    'astrophysics', 'astronomy', 'cosmology',
    'modern physics', 'relativity', 'special relativity', 'general relativity',
    'circuits', 'electronics',
    'fluid dynamics', 'fluid mechanics',
  ],

  Chemistry: [
    'chemistry', 'chem',
    'organic chemistry', 'organic chem', 'organic',
    'inorganic chemistry', 'inorganic chem', 'inorganic',
    'physical chemistry', 'physical chem',
    'analytical chemistry', 'analytical chem',
    'biochemistry', 'biochem',
    'environmental chemistry',
    'industrial chemistry',
    'stoichiometry', 'thermochemistry', 'electrochemistry',
    'acids', 'bases', 'equilibrium', 'kinetics',
    'periodic table', 'chemical bonding', 'molecular structure',
  ],

  Biology: [
    'biology', 'bio',
    'cell biology', 'cell bio', 'cytology',
    'genetics', 'heredity', 'dna', 'rna', 'genomics',
    'ecology', 'ecosystems', 'environment',
    'evolution', 'natural selection', 'darwin',
    'human anatomy', 'anatomy', 'physiology', 'human physiology',
    'microbiology', 'microbio', 'bacteria', 'viruses',
    'biotechnology', 'biotech', 'genetic engineering',
    'neuroscience', 'neurobiology',
    'plant biology', 'botany',
    'marine biology',
    'molecular biology',
  ],

  ComputerScience: [
    'computer science', 'cs', 'comp sci', 'computing',
    'programming', 'coding', 'code',
    'python', 'java', 'javascript', 'c++', 'c#', 'rust', 'go', 'typescript',
    'data structures', 'algorithms', 'algo',
    'databases', 'sql', 'nosql',
    'operating systems', 'os',
    'networking', 'networks', 'tcp', 'http',
    'cybersecurity', 'security', 'hacking', 'cryptography',
    'web development', 'web dev', 'frontend', 'backend', 'fullstack',
    'software engineering', 'software development',
    'ai', 'machine learning', 'ml', 'deep learning', 'neural networks',
    'data science', 'data analysis',
    'computer architecture', 'hardware',
    'technology', 'tech',
  ],

  History: [
    'history',
    'world history',
    'canadian history', 'canada history',
    'us history', 'american history', 'united states history',
    'european history', 'europe history',
    'ancient history', 'ancient civilizations', 'ancient egypt', 'ancient rome', 'ancient greece',
    'military history', 'wars', 'world war', 'ww1', 'ww2', 'world war 1', 'world war 2',
    'political history', 'politics',
    'economic history',
    'medieval history', 'middle ages',
    'renaissance', 'reformation',
    'cold war', 'colonialism', 'imperialism',
    'geography', 'social studies',
  ],

  Literature: [
    'literature', 'lit',
    'english', 'english lit', 'english literature',
    'world literature', 'world lit',
    'comparative literature', 'comparative lit',
    'poetry', 'poems', 'verse',
    'drama', 'drama studies', 'theatre', 'theater', 'plays',
    'literary analysis', 'literary criticism',
    'creative writing', 'writing', 'fiction writing',
    'classical literature', 'classics',
    'modern literature', 'contemporary literature',
    'novels', 'short stories', 'essays',
    'shakespeare', 'rhetoric', 'composition',
    'grammar', 'language arts',
  ],

  Economics: [
    'economics', 'econ',
    'microeconomics', 'micro',
    'macroeconomics', 'macro',
    'international economics', 'international trade', 'trade',
    'development economics', 'development',
    'behavioral economics', 'behavioural economics',
    'econometrics',
    'finance', 'financial markets', 'investing', 'stocks', 'bonds',
    'accounting', 'business', 'business studies',
    'supply and demand', 'market', 'gdp', 'inflation',
  ],

};

// ── Lookup function ───────────────────────────────────────────────────────────
// Returns the main subject key for any alias, or 'Other' if not found.
// Case-insensitive, trims whitespace. Uses word-boundary matching to avoid
// substring false positives (e.g. "chemistry" inside "electrochemistry").

export function resolveSubject(input) {
  if (!input) return 'Other';
  const normalised = input.trim().toLowerCase();

  for (const [subject, aliases] of Object.entries(SUBJECT_ALIASES)) {
    if (aliases.some(a => {
      // Exact match OR alias appears as a whole word within the input
      const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(normalised) || normalised === a;
    })) {
      return subject;
    }
  }

  return 'Other';
}

// ── Student intent detector ───────────────────────────────────────────────────
// Only fires on explicit "switch to X" from the student.

const STUDENT_SWITCH_PATTERN = /\bswitch(?:ing)?\s+to\s+([a-z][a-z\s&+]{1,30}?)(?:\s+now|\s+today|\s+please|[.!,?]|$)/i;

export function detectStudentSwitch(transcript) {
  const match = transcript.match(STUDENT_SWITCH_PATTERN);
  if (!match) return null;
  const resolved = resolveSubject(match[1].trim());
  return resolved !== 'Other' ? resolved : null;
}

// ── AI confirmation detector ──────────────────────────────────────────────────
// Fires on the AI's confirmation — "Sure, switching to X now!" or "Sure, switching to X"
// Pattern is intentionally loose — the AI doesn't always say "now" despite the prompt.

const SWITCH_PATTERN = /\bswitch(?:ing)?\s+to\s+([a-z][a-z\s&+]{1,30}?)(?:\s+now|\s+today|[.!,?]|\s*$|$)/i;

export function detectVoiceSwitch(transcript) {
  const match = transcript.match(SWITCH_PATTERN);
  if (!match) return null;
  const resolved = resolveSubject(match[1].trim());
  return resolved !== 'Other' ? resolved : null;
}
