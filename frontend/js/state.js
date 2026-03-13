// ── state.js ──────────────────────────────────────────────────────────────────
// Single source of truth for all shared app state.

export const state = {
  // Camera
  stream:              null,
  frameCount:          0,
  busy:                false,     // analyze is running
  chatBusy:            false,     // chat fetch is running
  hasAnalyzed:         false,

  // Conversation
  conversationHistory: [],

  // Subject detection
  currentSubject:      'Other',
  subjectManuallySet:  false,     // true when student picked from dropdown

  // Complexity tracking
  lastComplexity:      null,      // last detected level — passed to /chat each turn

  // Active fetch abort controller — set while chat or analyze is streaming
  abortController:     null,

  // Firebase session tracking — null means no session saved yet this conversation
  currentSessionId:    null,

  // Subject locked at first save — never changes for the lifetime of the session
  sessionSubject:      null,
};
