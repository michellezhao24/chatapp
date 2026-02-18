# Chat App

A React chatbot with Gemini AI, user auth, and MongoDB persistence. Yale-inspired styling with streaming responses and image support.

## How It Works

- **Frontend (React)** – Login/create account, chat UI with streaming, drag-and-drop images
- **Backend (Express)** – REST API for users and messages, connects to MongoDB
- **AI (Gemini)** – Chat responses streamed in real time
- **Storage (MongoDB)** – Users and messages stored in `chatapp` database

## API Keys & Environment Variables

Create a `.env` file in the project root with:

| Variable | Required | Description |
|----------|----------|-------------|
| `REACT_APP_GEMINI_API_KEY` | Yes | Google Gemini API key for chat. Get one at [Google AI Studio](https://aistudio.google.com/apikey). |
| `REACT_APP_MONGODB_URI` | Yes | MongoDB Atlas connection string. Format: `mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/` |

The backend also accepts `MONGODB_URI` or `REACT_APP_MONGO_URI` if you prefer those names.

### Example `.env`

```
REACT_APP_GEMINI_API_KEY=AIzaSy...
REACT_APP_MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/
```

## MongoDB Setup

1. Create a [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) account and cluster.
2. Get your connection string (Database → Connect → Drivers).
3. Put it in `.env` as `REACT_APP_MONGODB_URI`.

All collections are created automatically on first use.

### Database: `chatapp`

#### Collection: `users`

One document per registered user.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Auto-generated |
| `username` | string | Lowercase username |
| `password` | string | bcrypt hash |
| `email` | string | Email address (optional) |
| `createdAt` | string | ISO timestamp |

#### Collection: `sessions`

One document per chat conversation.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Auto-generated — used as `session_id` |
| `username` | string | Owner of this chat |
| `agent` | string | AI persona (e.g. `"lisa"`) |
| `title` | string | Auto-generated name, e.g. `"Chat · Feb 18, 2:34 PM"` |
| `createdAt` | string | ISO timestamp |
| `messages` | array | Ordered list of messages (see below) |

Each item in `messages`:

| Field | Type | Description |
|-------|------|-------------|
| `role` | string | `"user"` or `"model"` |
| `content` | string | Message text |
| `timestamp` | string | ISO timestamp |
| `imageData` | array | *(optional)* Base64 image attachments |

## Running the App

### Option 1: Both together (single terminal)

```bash
npm install
npm start
```

### Option 2: Separate terminals (recommended for development)

First, install dependencies once:

```bash
npm install
```

Then open two terminals in the project root:

**Terminal 1 — Backend:**
```bash
npm run server
```

**Terminal 2 — Frontend:**
```bash
npm run client
```

This starts:

- **Backend** – http://localhost:3001  
- **Frontend** – http://localhost:3000  

Use the app at **http://localhost:3000**. The React dev server proxies `/api` requests to the backend.

### Verify Backend

- http://localhost:3001 – Server status page  
- http://localhost:3001/api/status – JSON with `usersCount` and `sessionsCount`

## Features

- **Create account / Login** – Username + password, hashed with bcrypt
- **Chat** – Streaming Gemini responses
- **Image support** – Drag images into the chat
- **History** – Messages saved to MongoDB and loaded on login

## Chat System Prompt

The AI’s system instructions are loaded from **`public/prompt_chat.txt`**. Edit this file to change the assistant’s behavior (tone, role, format, etc.). Changes take effect on the next message; no rebuild needed.

### How to Get a Good Persona Prompt (Make the AI Sound Like Someone)

To make the AI sound like a specific person (celebrity, character, or role), ask your AI assistant or prompt engineer to do the following:

1. **Pull a bio** – “Look up [person’s name] on Wikipedia and summarize their background, career, and key facts.”

2. **Find speech examples** – “Search for interviews [person] has done and pull direct quotes that show how they talk—phrases they use, tone, vocabulary.”

3. **Describe the vibe** – “What’s their personality? Confident, shy, funny, formal? List 3–5 traits.”

4. **Define the role** – “This person is my assistant for [context, e.g. a Yale SOM course on Generative AI]. They should help with [specific tasks] while staying in character.”

5. **Ask for the full prompt** – “Write a system prompt for `prompt_chat.txt` that includes: (a) a short bio, (b) speech examples and phrases to mimic, (c) personality traits, and (d) their role as my assistant for [your use case].”

**Example request you can paste into ChatGPT/Claude/etc.:**

> Write a system prompt for a chatbot. The AI should sound like [Person X]. Pull their Wikipedia page and 2–3 interviews. Include: (1) a brief bio, (2) 5–8 direct quotes showing how they speak, (3) personality traits, and (4) their role as my teaching assistant for [Course Name] taught by [Professor] at [School]. Put it all in a format I can paste into `prompt_chat.txt`.
