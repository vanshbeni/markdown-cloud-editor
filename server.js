// ─────────────────────────────────────────────────────────────
//  server.js  —  Markdown Cloud Editor Backend
//  Stack: Express + @supabase/supabase-js v2
// ─────────────────────────────────────────────────────────────
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase admin client (service role — server-side only) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ───────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Inject public env vars into frontend ───────────────────────
//    The anon key is safe to expose; service role key stays server-side
app.get('/api/env', (_req, res) => {
  res.json({
    SUPABASE_URL:      process.env.SUPABASE_URL      || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  });
});

// ── POST /api/rooms ───────────────────────────────────────────
//    Creates a new room and a default "notes.md" file inside it
app.post('/api/rooms', async (_req, res) => {
  try {
    // 1. Insert room
    const { data: room, error: roomErr } = await supabase
      .from('rooms')
      .insert({})
      .select()
      .single();

    if (roomErr) throw roomErr;

    // 2. Seed with a default file
    const { data: file, error: fileErr } = await supabase
      .from('files')
      .insert({
        room_id: room.id,
        name: 'notes.md',
        content: '# Welcome to your conference\n\nStart typing here. Changes sync in real-time across all participants.\n\n---\n\n> Share this URL to collaborate instantly.',
      })
      .select()
      .single();

    if (fileErr) throw fileErr;

    res.json({ roomId: room.id, fileId: file.id });
  } catch (err) {
    console.error('[POST /api/rooms]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/rooms/:roomId/files ──────────────────────────────
//    Returns all files belonging to a room (ordered by creation)
app.get('/api/rooms/:roomId/files', async (req, res) => {
  try {
    const { roomId } = req.params;

    const { data: files, error } = await supabase
      .from('files')
      .select('id, name, updated_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'Room not found or has no files.' });
    }

    res.json({ files });
  } catch (err) {
    console.error('[GET /api/rooms/:roomId/files]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/files/:fileId ────────────────────────────────────
//    Fetches the full content of a single file
app.get('/api/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;

    const { data: file, error } = await supabase
      .from('files')
      .select('id, name, content, updated_at')
      .eq('id', fileId)
      .single();

    if (error) throw error;
    res.json({ file });
  } catch (err) {
    console.error('[GET /api/files/:fileId]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/rooms/:roomId/files ─────────────────────────────
//    Creates a new .md file inside the room
app.post('/api/rooms/:roomId/files', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { name }   = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'File name is required.' });
    }

    const safeName = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`;

    const { data: file, error } = await supabase
      .from('files')
      .insert({ room_id: roomId, name: safeName, content: `# ${safeName.replace('.md','')}\n\n` })
      .select()
      .single();

    if (error) throw error;
    res.json({ file });
  } catch (err) {
    console.error('[POST /api/rooms/:roomId/files]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/files/:fileId ──────────────────────────────────
//    Persists the latest content of a file (called by debounced save)
app.patch('/api/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { content } = req.body;

    if (content === undefined) {
      return res.status(400).json({ error: 'content is required.' });
    }

    const { data: file, error } = await supabase
      .from('files')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', fileId)
      .select('id, name, updated_at')
      .single();

    if (error) throw error;
    res.json({ file });
  } catch (err) {
    console.error('[PATCH /api/files/:fileId]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/files/:fileId ─────────────────────────────────
//    Deletes a file (only if room has more than 1 file)
app.delete('/api/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;

    // Fetch file to know its room
    const { data: file, error: fetchErr } = await supabase
      .from('files').select('room_id').eq('id', fileId).single();
    if (fetchErr) throw fetchErr;

    // Count files in room
    const { count, error: countErr } = await supabase
      .from('files').select('*', { count: 'exact', head: true })
      .eq('room_id', file.room_id);
    if (countErr) throw countErr;

    if (count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last file in a room.' });
    }

    const { error: delErr } = await supabase.from('files').delete().eq('id', fileId);
    if (delErr) throw delErr;

    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/files/:fileId]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SPA fallback — serve index.html for /:roomId routes ───────
app.get('/:roomId', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Markdown Cloud Editor running at http://localhost:${PORT}\n`);
});
