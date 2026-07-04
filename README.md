# MarkCloud — Real-time Collaborative Markdown Editor

> **Stack**: Node.js + Express · Supabase (PostgreSQL + Realtime + Presence) · Vanilla JS · Tailwind CSS · Marked.js

---

## Quick Start (Local)

```bash
# 1. Clone / enter project
cd markdown-cloud-editor

# 2. Install dependencies
npm install

# 3. Copy env file and fill in your Supabase credentials
cp .env.example .env

# 4. Run the server
npm run dev      # with nodemon (auto-reload)
# or
npm start        # plain node

# 5. Open http://localhost:3000
```

---

## Step 1 — Set Up Supabase

### 1.1 Create a project
1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Click **New Project** → choose a name, password, and region
3. Wait ~2 minutes for provisioning

### 1.2 Run the schema
1. In your Supabase dashboard, go to **SQL Editor → New Query**
2. Paste the entire contents of `supabase-schema.sql`
3. Click **Run**
4. You should see: `rooms` and `files` tables created with RLS policies

### 1.3 Enable Realtime
1. Go to **Database → Replication** (left sidebar)
2. Under **Tables** find `files` and toggle it **ON**
3. This enables Supabase Realtime to broadcast row changes

### 1.4 Get your API keys
1. Go to **Settings → API**
2. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon / public** key → `SUPABASE_ANON_KEY`
   - **service_role / secret** key → `SUPABASE_SERVICE_ROLE_KEY`

### 1.5 Fill in `.env`
```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PORT=3000
```

---

## Step 2 — Test Locally

1. Run `npm start`
2. Open [http://localhost:3000](http://localhost:3000)
3. Click **Start New Conference** — you'll be redirected to `/:roomId`
4. Open the **same URL** in a second browser tab
5. Type in one tab — you should see the text appear in the other tab instantly ✅
6. Check the **"👥 2 online"** presence indicator updates ✅

---

## Step 3 — Deploy to Render (Backend)

1. Push your project to a GitHub repo
2. Go to [https://render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: `Node`
5. Add environment variables (from your `.env`):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PORT` = `3000`
6. Click **Deploy**
7. Your app will be live at `https://your-app.onrender.com`

> **Note**: Render free tier spins down after inactivity. For always-on, upgrade to paid or use Railway.

---

## Step 4 — Deploy to Railway (Alternative Backend)

1. Go to [https://railway.app](https://railway.app) → **New Project → Deploy from GitHub**
2. Select your repo
3. Railway auto-detects Node.js — no build config needed
4. Add the same environment variables under **Variables**
5. Your app deploys automatically on every push

---

## Directory Structure

```
markdown-cloud-editor/
├── public/
│   ├── index.html          # Full split-screen editor UI
│   └── app.js              # All frontend logic
├── server.js               # Express API + Supabase admin client
├── supabase-schema.sql     # Run this in Supabase SQL Editor
├── package.json
├── .env.example            # Template for environment variables
└── README.md
```

---

## Architecture Overview

```
Browser (User A)                    Browser (User B)
     │                                    │
     │  types in textarea                 │
     │                                    │
     ├─→ Supabase Broadcast Channel ──────┤ instant (no DB write)
     │   room:{roomId}:file:{fileId}      │
     │                                    │
     ├─→ debounce 1000ms                  │
     │                                    │
     └─→ PATCH /api/files/:id ──→ Supabase PostgreSQL (persists)
                                          │
                              on next page load: fetch from DB
```

**Key separation:**
- **Broadcast** = real-time typing sync (fires every keystroke, zero DB writes)
- **PATCH /api/files/:id** = persistence (fires 1s after last keystroke)
- **Presence** = online user count (Supabase Presence channel)

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + S` | Force save immediately |
| `Ctrl/⌘ + B` | Bold |
| `Ctrl/⌘ + I` | Italic |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | Public anon key (safe to expose in frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-side admin key (never expose in frontend) |
| `PORT` | optional | Server port (default: 3000) |
