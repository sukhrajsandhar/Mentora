// ── prompts.js (frontend) ─────────────────────────────────────────────────────
export const IMAGE_TRIGGERS = /\b(draw|diagram|illustrate|sketch|show me|visuali[sz]e|generate.*image|image of|picture of|chart of|map of|with a diagram|with diagram|labeled diagram|label.{0,20}diagram|explain.{0,30}diagram|diagram.{0,30}explain)\b/i;

export const DOC_TRIGGERS = /\b(write me|write out|explain in writing|write it out|write.*notes|notes on|make me.*notes|give me.*notes|create.*document|lay it out in writing)\b/i;

export function liveDocPrompt(userRequest) {
  return `The student asked (via voice): "${userRequest}". Generate a clear, structured written document — use headings, numbered steps, bullet points, bold key terms, and code blocks if relevant. Make it something the student can read, follow along with, and keep as study notes. Be thorough.`;
}

export const PERSONA_NAMES = {
  Math:            'Prof. Maya',
  Physics:         'Dr. Arun',
  Chemistry:       'Dr. Sofia',
  Biology:         'Dr. Kezia',
  ComputerScience: 'Alex',
  History:         'Prof. James',
  Literature:      'Prof. Claire',
  Economics:       'Prof. David',
  Other:           'Sam',
};