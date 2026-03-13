# Mentora — AI Tutoring App

An AI-powered tutoring assistant that analyzes your whiteboard or notebook in real time, answers questions, and helps you study through voice, chat, practice tests, summaries, and flashcards.

Built by [Manraaj Singh](https://github.com/Umbra-Domini) & [Sukhraj Sandhar](https://github.com/sukhrajsandhar)

---

## Features

- **Live whiteboard analysis** — point your camera at notes or equations and get instant explanations
- **AI chat** — subject-aware tutoring across Math, Physics, Chemistry, Biology, CS, History, Literature, and Economics
- **Voice mode** — real-time voice conversation with Gemini Live API
- **Practice tests** — generate tests from your session, typed notes, or uploaded files
- **Summaries** — get a structured summary of any tutoring session
- **Flashcards** — auto-generate flashcards from your session
- **File attachment** — attach PDFs or images directly in chat
- **Session history** — all chats saved to Firestore, accessible across sessions
- **Subject-aware personas** — each subject has its own tutor personality
- **Adaptive complexity** — automatically adjusts explanation depth based on your level

---

## Tech Stack

**Frontend**
- Vanilla JS (ES modules)
- Firebase Firestore (client SDK) — session storage
- Hosted on Firebase Hosting

**Backend**
- Node.js + Express
- Google Vertex AI — all AI endpoints (chat, analyze, practice test, summarize, flashcards)
- Gemini Live API — real-time voice WebSocket proxy
- Google Secret Manager — stores the Live API key securely
- Deployed on Google Cloud Run

---

## Project Structure

```
Mentora/
├── backend/
│   ├── js/
│   │   ├── server.js        # Main Express server + WebSocket proxy
│   │   ├── prompts.js       # All AI prompts
│   │   ├── personas.js      # Subject tutor personas
│   │   ├── complexity.js    # Complexity detection logic
│   │   ├── formats.js       # Response formatting helpers
│   │   └── gemini.js        # Legacy Gemini helper
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── index.html
│   ├── js/
│   │   ├── app.js           # App entry point
│   │   ├── config.js        # Backend URL config
│   │   ├── firebase.js      # Firestore session CRUD
│   │   ├── messages.js      # Chat message handling
│   │   ├── history.js       # Session history sidebar
│   │   ├── voice.js         # Voice/Live API
│   │   ├── camera.js        # Webcam capture
│   │   ├── practice-test.js # Practice test UI
│   │   ├── summary.js       # Session summary
│   │   ├── flashcards.js    # Flashcard UI
│   │   ├── fileAttach.js    # File attachment
│   │   ├── export.js        # Export session
│   │   └── state.js         # Global state
│   └── css/
├── firebase.json
├── firestore.rules
└── .firebaserc
```

---

## Setup

### Prerequisites
- Node.js 20+
- Google Cloud SDK
- Firebase CLI (`npm install -g firebase-tools`)
- A Google Cloud project with these APIs enabled:
  - Vertex AI
  - Cloud Run
  - Secret Manager
  - Firestore

### Local Development

1. Clone the repo:
   ```
   git clone https://github.com/sukhrajsandhar/Mentora.git
   cd Mentora
   ```

2. Install backend dependencies:
   ```
   cd backend
   npm install
   ```

3. Create `backend/.env`:
   ```
   GEMINI_API_KEY=your_gemini_api_key
   GCP_PROJECT=mentora-main
   ```

4. Start the backend:
   ```
   npm run dev
   ```

5. Open `frontend/index.html` in your browser (or use a local server).

---

### Deployment

**Backend (Cloud Run):**
```
cd backend
gcloud run deploy sketchsense-backend \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars GCP_PROJECT=mentora-main
```

**Frontend (Firebase Hosting):**
```
firebase deploy --only hosting,firestore
```

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `GCP_PROJECT` | Cloud Run | Your Google Cloud project ID |
| `GEMINI_API_KEY` | Secret Manager | Gemini API key for Live voice API |

> The backend uses Application Default Credentials (ADC) for Vertex AI — no API key needed for regular AI endpoints.

---

## License

MIT