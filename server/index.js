require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const Replicate = require('replicate');
const sharp = require('sharp');
const multer = require('multer');
const { downloadChannelData } = require('./youtubeDownload');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';

let db;

async function connect() {
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: firstName ? String(firstName).trim() : null,
      lastName: lastName ? String(lastName).trim() : null,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/replicate-account', async (req, res) => {
  try {
    const apiKey = process.env.REPLICATE_API_TOKEN;
    if (!apiKey) return res.json({ ok: false, error: 'REPLICATE_API_TOKEN not set' });
    const replicate = new Replicate({ auth: apiKey });
    const account = await replicate.accounts.current();
    res.json({ ok: true, account: account?.username || account?.name || 'unknown', type: account?.type });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.get('/api/generate-image-test', async (req, res) => {
  try {
    const apiKey = process.env.REPLICATE_API_TOKEN;
    if (!apiKey) return res.json({ ok: false, error: 'REPLICATE_API_TOKEN not set' });
    const replicate = new Replicate({ auth: apiKey });
    const output = await replicate.run('stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc', { input: { prompt: 'a simple red circle' } });
    const url = Array.isArray(output) ? output[0] : output;
    const href = typeof url === 'string' ? url : (typeof url?.url === 'function' ? url.url().href : null);
    res.json({ ok: true, message: href ? 'Replicate API works' : 'Unexpected output format' });
  } catch (err) {
    const msg = err.message || '';
    const friendly = /402|insufficient credit|payment required/i.test(msg)
      ? 'Your Replicate account needs credit. Add billing at https://replicate.com/account/billing'
      : msg;
    res.json({ ok: false, error: friendly });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** Run a Replicate model with retry on 429 rate limit. */
async function replicateRunWithRetry(replicate, modelId, input, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await replicate.run(modelId, input);
    } catch (err) {
      const msg = String(err.message || '');
      const is429 = /429|too many requests|rate limit|throttl/i.test(msg);
      let waitMs = 15000;
      const retryAfterHeader = err.response?.headers?.get?.('retry-after') ?? err.response?.headers?.get?.('Retry-After');
      if (retryAfterHeader) {
        const sec = parseInt(retryAfterHeader, 10);
        if (!isNaN(sec)) waitMs = Math.min(sec * 1000, 60000);
      } else {
        const match = msg.match(/resets?\s+in\s+~?(\d+)/i) || msg.match(/~(\d+)\s*s/i);
        if (match) waitMs = Math.min(parseInt(match[1], 10) * 1000 + 2000, 60000);
      }
      if (is429 && attempt < maxRetries) {
        console.warn(`[generate-image] Rate limited, waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${maxRetries}`);
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        throw err;
      }
    }
  }
}

app.post('/api/generate-image', upload.single('anchor_image'), async (req, res) => {
  try {
    let prompt, anchor_image_base64;
    if (req.file) {
      prompt = req.body?.prompt || req.body?.[0]?.prompt || '';
      anchor_image_base64 = req.file.buffer.toString('base64');
    } else {
      ({ prompt, anchor_image_base64 } = req.body || {});
    }
    if (!prompt || typeof prompt !== 'string')
      return res.status(400).json({ error: 'prompt is required' });

    const apiKey = process.env.REPLICATE_API_TOKEN;
    if (!apiKey) {
      return res.status(503).json({
        error: 'Image generation is not available yet. The administrator needs to configure the Replicate API token.',
      });
    }

    const replicate = new Replicate({ auth: apiKey, fileEncodingStrategy: 'upload' });
    const SDXL_ID = 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc';
    const INSTANTID_ID = 'zsxkib/instant-id-ipadapter-plus-face';

    let anchorBuf = null;
    if (req.file?.buffer) {
      anchorBuf = req.file.buffer;
    } else if (anchor_image_base64 && typeof anchor_image_base64 === 'string') {
      const raw = anchor_image_base64.replace(/^data:image\/\w+;base64,/, '').replace(/\s/g, '');
      if (raw.length > 500000) anchor_image_base64 = null;
      else if (raw.length >= 100) anchorBuf = Buffer.from(raw, 'base64');
    }

    let output;
    if (anchorBuf) {
      try {
        const resized = await sharp(anchorBuf)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();
        output = await replicateRunWithRetry(replicate, INSTANTID_ID, {
          input: {
            image: resized,
            prompt,
            negative_prompt: 'abstract, distorted, blurry, deformed, ugly, bad anatomy, disfigured, amorphous, cartoon, painting',
            steps: 30,
            instantid_weight: 0.8,
            ipadapter_weight: 0.7,
          },
        });
      } catch (instantErr) {
        console.warn('[generate-image] InstantID failed, falling back to SDXL text-only:', instantErr.message);
        output = await replicateRunWithRetry(replicate, SDXL_ID, { input: { prompt } });
      }
    } else {
      output = await replicateRunWithRetry(replicate, SDXL_ID, { input: { prompt } });
    }

    const imageOutput = Array.isArray(output) ? output[0] : output;
    if (!imageOutput) {
      console.error('[generate-image] No image in output:', output);
      return res.status(500).json({ error: 'No image returned from Replicate' });
    }

    let buf;
    const getUrl = (o) => {
      if (typeof o === 'string') return o;
      if (typeof o?.url === 'function') return o.url().href;
      if (o?.href) return o.href;
      return null;
    };
    const href = getUrl(imageOutput);
    if (!href) {
      console.error('[generate-image] Could not extract URL from:', imageOutput);
      return res.status(500).json({ error: 'Invalid response format from Replicate' });
    }
    const imgRes = await fetch(href);
    if (!imgRes.ok) {
      console.error('[generate-image] Fetch failed:', imgRes.status, href);
      return res.status(500).json({ error: 'Failed to fetch generated image' });
    }
    buf = Buffer.from(await imgRes.arrayBuffer());
    const base64 = buf.toString('base64');
    return res.json({ image_base64: base64, mimeType: 'image/png' });
  } catch (err) {
    console.error('[generate-image] Error:', err.message);
    const msg = String(err.message || '');
    let friendly = msg;
    if (/429|too many requests|rate limit|throttl/i.test(msg)) {
      const secMatch = msg.match(/~?(\d+)\s*s/i);
      const sec = secMatch ? parseInt(secMatch[1], 10) : 30;
      friendly = `Rate limited by Replicate. Wait ~${sec} seconds and try again. Limits reset automatically. Add a payment method at replicate.com/account/billing for higher limits.`;
    } else if (/402|insufficient credit|payment required/i.test(msg)) {
      friendly = 'Your Replicate account needs credit. Add billing at https://replicate.com/account/billing';
    }
    res.status(500).json({ error: friendly });
  }
});

app.post('/api/youtube-download', async (req, res) => {
  try {
    const { channelUrl, maxVideos = 10 } = req.body;
    const max = Math.min(Math.max(parseInt(maxVideos, 10) || 10, 1), 100);

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (obj) => res.write(JSON.stringify(obj) + '\n');

    const videos = await downloadChannelData(channelUrl, max, (pct, msg) => {
      send({ type: 'progress', progress: pct, message: msg });
    });

    const channelName = videos[0]?.title ? 'channel' : 'channel';
    const output = {
      channelUrl,
      downloadedAt: new Date().toISOString(),
      videoCount: videos.length,
      videos,
    };

    send({ type: 'complete', data: output });
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
    res.end();
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({
      ok: true,
      username: name,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const { title } = req.body;
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// JSON parse error handler (e.g. truncated body → "unterminated string literal")
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.message?.includes('string')) {
    return res.status(400).json({ error: 'Image data was too large or corrupted. Try a smaller image or text-only generation.' });
  }
  next(err);
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

connect()
  .then(() => {
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
