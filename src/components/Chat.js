import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import html2canvas from 'html2canvas';
import remarkGfm from 'remark-gfm';
import { streamChat, chatWithCsvTools, CODE_KEYWORDS } from '../services/gemini';
import { parseCsvToRows, executeTool, computeDatasetSummary, enrichWithEngagement, buildSlimCsv } from '../services/csvTools';
import {
  getSessions,
  createSession,
  deleteSession,
  saveMessage,
  loadMessages,
} from '../services/mongoApi';
import EngagementChart from './EngagementChart';
import MetricVsTimeChart from './MetricVsTimeChart';
import YouTubeDownload from './YouTubeDownload';
import './Chat.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const chatTitle = () => {
  const d = new Date();
  return `Chat · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// Encode a string to base64 safely (handles unicode/emoji in tweet text etc.)
const toBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const parseCSV = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rowCount = lines.length - 1;

  // Short human-readable preview (header + first 5 rows) for context
  const preview = lines.slice(0, 6).join('\n');

  // Full CSV as base64 — avoids ALL string-escaping issues in Python code execution
  // (tweet text with quotes, apostrophes, emojis, etc. all break triple-quoted strings)
  const raw = text.length > 500000 ? text.slice(0, 500000) : text;
  const base64 = toBase64(raw);
  const truncated = text.length > 500000;

  return { headers, rowCount, preview, base64, truncated };
};

// Extract plain text from a message (for history only — never returns base64)
const messageText = (m) => {
  if (!m) return '';
  const parts = Array.isArray(m.parts) ? m.parts : [];
  if (parts.length) return parts.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n');
  return m.content || '';
};

// ── Structured part renderer (code execution responses) ───────────────────────

function StructuredParts({ parts }) {
  const safeParts = Array.isArray(parts) ? parts : [];
  return (
    <>
      {safeParts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim()) {
          return (
            <div key={i} className="part-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        if (part.type === 'code') {
          return (
            <div key={i} className="part-code">
              <div className="part-code-header">
                <span className="part-code-lang">
                  {part.language === 'PYTHON' ? 'Python' : part.language}
                </span>
              </div>
              <pre className="part-code-body">
                <code>{part.code}</code>
              </pre>
            </div>
          );
        }
        if (part.type === 'result') {
          const ok = part.outcome === 'OUTCOME_OK';
          return (
            <div key={i} className="part-result">
              <div className="part-result-header">
                <span className={`part-result-badge ${ok ? 'ok' : 'err'}`}>
                  {ok ? '✓ Output' : '✗ Error'}
                </span>
              </div>
              <pre className="part-result-body">{part.output}</pre>
            </div>
          );
        }
        if (part.type === 'image') {
          return (
            <img
              key={i}
              src={`data:${part.mimeType};base64,${part.data}`}
              alt="Generated plot"
              className="part-image"
            />
          );
        }
        return null;
      })}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Chat({ username, firstName, lastName, onLogout }) {
  const [activeTab, setActiveTab] = useState('chat');
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [csvContext, setCsvContext] = useState(null);     // pending attachment chip
  const [jsonContext, setJsonContext] = useState(null);   // pending JSON attachment
  const [sessionCsvRows, setSessionCsvRows] = useState(null);    // parsed rows for JS tools (CSV or JSON)
  const [sessionCsvHeaders, setSessionCsvHeaders] = useState(null); // headers for tool routing
  const [csvDataSummary, setCsvDataSummary] = useState(null);    // auto-computed column stats summary
  const [sessionSlimCsv, setSessionSlimCsv] = useState(null);   // key-columns CSV string sent directly to Gemini
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [enlargedItem, setEnlargedItem] = useState(null);
  const chartExportRef = useRef(null);
  const dropZoneRef = useRef(null);

  const bottomRef = useRef(null);

  const downloadChartAsPng = async () => {
    if (!chartExportRef.current) return;
    try {
      const canvas = await html2canvas(chartExportRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const link = document.createElement('a');
      link.download = 'chart.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('Chart export failed:', e);
    }
  };
  const inputRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  // Set to true immediately before setActiveSessionId() is called during a send
  // so the messages useEffect knows to skip the reload (streaming is in progress).
  const justCreatedSessionRef = useRef(false);

  // On login: load sessions from DB; 'new' means an unsaved pending chat
  useEffect(() => {
    const init = async () => {
      const list = await getSessions(username);
      setSessions(list);
      setActiveSessionId('new'); // always start with a fresh empty chat on login
    };
    init();
  }, [username]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === 'new') {
      setMessages([]);
      return;
    }
    // If a session was just created during an active send, messages are already
    // in state and streaming is in progress — don't wipe them.
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    setMessages([]);
    loadMessages(activeSessionId).then((data) => setMessages(Array.isArray(data) ? data : []));
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Session management ──────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId('new');
    setMessages([]);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
  };

  const handleSelectSession = (sessionId) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);
    await deleteSession(sessionId);
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : 'new');
      setMessages([]);
    }
  };

  // ── File handling ───────────────────────────────────────────────────────────

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const compressImageForUpload = (file) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 384;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = (h * MAX) / w; w = MAX; } else { w = (w * MAX) / h; h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          const b64 = dataUrl.split(',')[1] || '';
          resolve({ data: b64.replace(/\s/g, ''), mimeType: 'image/jpeg' });
        } catch (e) {
          fileToBase64(file).then((data) => resolve({ data, mimeType: file.type })).catch(reject);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); fileToBase64(file).then((data) => resolve({ data, mimeType: file.type })).catch(reject); };
      img.src = url;
    });

  const fileToText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });

  const loadJsonAsRows = (data) => {
    let videos = [];
    if (Array.isArray(data)) videos = data;
    else if (data?.videos && Array.isArray(data.videos)) videos = data.videos;
    else if (data?.items && Array.isArray(data.items)) videos = data.items;
    if (!videos.length) return null;
    const headers = Object.keys(videos[0]);
    const rows = videos.map((v) => ({ ...v }));
    return { headers, rows };
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = [...e.dataTransfer.files];

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      const file = jsonFiles[0];
      const text = await fileToText(file);
      try {
        const data = JSON.parse(text);
        const parsed = loadJsonAsRows(data);
        if (parsed) {
          setJsonContext({ name: file.name, videoCount: parsed.rows.length });
          setSessionCsvHeaders(parsed.headers);
          setSessionCsvRows(parsed.rows);
          setCsvDataSummary(computeDatasetSummary(parsed.rows, parsed.headers));
          setSessionSlimCsv(null);
        }
      } catch (_) {}
    }

    if (csvFiles.length > 0) {
      const file = csvFiles[0];
      const text = await fileToText(file);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: file.name, ...parsed });
        // Parse rows, add computed engagement col, build summary + slim CSV
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => {
          const { data, mimeType } = await compressImageForUpload(f);
          return { data, mimeType, name: f.name };
        })
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      const text = await fileToText(jsonFiles[0]);
      try {
        const data = JSON.parse(text);
        const parsed = loadJsonAsRows(data);
        if (parsed) {
          setJsonContext({ name: jsonFiles[0].name, videoCount: parsed.rows.length });
          setSessionCsvHeaders(parsed.headers);
          setSessionCsvRows(parsed.rows);
          setCsvDataSummary(computeDatasetSummary(parsed.rows, parsed.headers));
          setSessionSlimCsv(null);
        }
      } catch (_) {}
    }

    if (csvFiles.length > 0) {
      const text = await fileToText(csvFiles[0]);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: csvFiles[0].name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }
    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => {
          const { data, mimeType } = await compressImageForUpload(f);
          return { data, mimeType, name: f.name };
        })
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  // ── Stop generation ─────────────────────────────────────────────────────────

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const newImages = await Promise.all(
      imageItems.map(
        (item) =>
          new Promise((resolve) => {
            const file = item.getAsFile();
            if (!file) return resolve(null);
            compressImageForUpload(file).then(({ data, mimeType }) =>
              resolve({ data, mimeType, name: 'pasted-image' })
            ).catch(() => resolve(null));
          })
      )
    );
    setImages((prev) => [...prev, ...newImages.filter(Boolean)]);
  };

  const handleStop = () => {
    abortRef.current = true;
  };

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length && !csvContext) || streaming || !activeSessionId) return;

    // Lazily create the session in DB on the very first message
    let sessionId = activeSessionId;
    if (sessionId === 'new') {
      const title = chatTitle();
      const { id } = await createSession(username, 'lisa', title);
      sessionId = id;
      justCreatedSessionRef.current = true; // tell useEffect to skip the reload
      setActiveSessionId(id);
      setSessions((prev) => [{ id, agent: 'lisa', title, createdAt: new Date().toISOString(), messageCount: 0 }, ...prev]);
    }

    // ── Routing intent (computed first so we know whether Python/base64 is needed) ──
    // PYTHON_ONLY = things the client tools genuinely cannot produce
    const PYTHON_ONLY_KEYWORDS = /\b(regression|scatter|histogram|seaborn|matplotlib|numpy|time.?series|heatmap|box.?plot|violin|distribut|linear.?model|logistic|forecast|trend.?line)\b/i;
    const wantPythonOnly = PYTHON_ONLY_KEYWORDS.test(text);
    const wantCode = CODE_KEYWORDS.test(text) && !sessionCsvRows;
    const capturedCsv = csvContext;
    const hasCsvInSession = !!sessionCsvRows || !!capturedCsv;
    // Base64 is only worth sending when Gemini will actually run Python
    const needsBase64 = !!capturedCsv && wantPythonOnly;
    // Mode selection:
    //   useTools        — CSV loaded or image-gen request + no Python needed → client-side JS tools (free, fast)
    //   useCodeExecution — Python explicitly needed (regression, histogram, etc.)
    //   else            — Google Search streaming (also used for "tell me about this file")
    const wantImageGen = /\b(generate|create|draw|make|style|chic|stylish).*(image|pic|photo|picture)|image\s+generat|put\s+(me|this|him|her)\s+in|(transform|style|make)\s+(this|me|it|him|her)|get\s+.*\s+image|(try|do)\s+it\s+again|(that|the)\s+.*\s+image|try\s+again|let'?s\s+try/i.test(text);
    const mentionsImage = /\b(image|photo|picture|generate|transform|style|chic|stylish)\b/i.test(text);
    const wantPlot = /\bplot\s+.*\s+(vs|over)\s+time|plot\s+(views|likes|metric|engagement)|plot\s+.*\s+over\s+time|channel\s+videos?\s+.*\s+plot/i.test(text);
    const hasData = !!sessionCsvRows;
    const hasImages = images.length > 0;
    // If user says "try again" / "yes" / "retry" after an image failure, use tools
    const lastModelMsg = [...messages].reverse().find((m) => m?.role === 'model');
    const lastModelText = lastModelMsg ? (lastModelMsg.content || messageText(lastModelMsg) || '') : '';
    const lastWasImageError = /image|generateImage|NameError|glitch|image generation tool|conjure|spell/i.test(lastModelText);
    const isRetryShort = text.length < 80 && /\b(try|yes|retry|ok|sure|again|please|do it|let'?s)\b/i.test(text);
    const retryImageContext = isRetryShort && lastWasImageError;
    // CRITICAL: Image gen MUST use tools (generateImage). Python has no generateImage → NameError.
    // Also force when user mentions image + action verb (generate, make, create, etc.)
    const forceToolsForImage = wantImageGen || hasImages || retryImageContext || (mentionsImage && /\b(get|make|create|generate|draw|try|do|conjure)\b/i.test(text));
    const useTools = forceToolsForImage || ((!wantPythonOnly && (!wantCode || mentionsImage || wantPlot) && (!capturedCsv || wantImageGen || hasImages)) && (hasData || wantPlot));
    // NEVER use code execution for image — Python does not have generateImage
    const useCodeExecution = !forceToolsForImage && (wantPythonOnly || (wantCode && !!sessionCsvRows && !mentionsImage && !wantPlot));

    // ── Build prompt ─────────────────────────────────────────────────────────
    // sessionSummary: auto-computed column stats, included with every message
    const sessionSummary = csvDataSummary || '';
    // slimCsv: key columns only (text, type, metrics, engagement) as plain readable CSV
    // ~6-10k tokens — Gemini reads it directly so it can answer from context or call tools
    const slimCsvBlock = sessionSlimCsv
      ? `\n\nFull dataset (key columns):\n\`\`\`csv\n${sessionSlimCsv}\n\`\`\``
      : '';

    const csvPrefix = capturedCsv
      ? needsBase64
        // Python path: send base64 so Gemini can load it with pandas
        ? `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

IMPORTANT — to load the full data in Python use this exact pattern:
\`\`\`python
import pandas as pd, io, base64
df = pd.read_csv(io.BytesIO(base64.b64decode("${capturedCsv.base64}")))
\`\`\`

---

`
        // Standard path: plain CSV text — no encoding needed
        : `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

---

`
      : sessionSummary
      ? `[Data columns: ${sessionCsvHeaders?.join(', ')}]\n\n${sessionSummary}\n\n---\n\n`
      : '';

    // userContent  — displayed in bubble and stored in MongoDB (never contains base64)
    // promptForGemini — sent to the Gemini API (may contain the full prefix)
    const dataAttached = csvContext || jsonContext;
    const userContent = text || (images.length ? '(Image)' : dataAttached ? `(${dataAttached.name} attached)` : '');
    const promptForGemini = csvPrefix + (text || (images.length ? 'What do you see in this image?' : dataAttached ? `Please analyze this ${jsonContext ? 'YouTube channel JSON' : 'CSV'} data.` : ''));

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: Array.isArray(images) ? [...images] : [],
      csvName: capturedCsv?.name || null,
      jsonName: jsonContext?.name || null,
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    const capturedImages = Array.isArray(images) ? [...images] : [];
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setStreaming(true);

    // Store display text only — base64 is never persisted
    await saveMessage(sessionId, 'user', userContent, capturedImages.length > 0 ? capturedImages : null);

    const imageParts = capturedImages
      .filter((img) => img && (img.data || img.mimeType))
      .map((img) => ({ mimeType: img.mimeType || 'image/png', data: img.data || '' }));

    // History: plain display text only — session summary handles CSV context on every message
    const safeMessages = Array.isArray(messages) ? messages : [];
    const history = safeMessages
      .filter((m) => m && (m.role === 'user' || m.role === 'model'))
      .map((m) => ({ role: m.role, content: m.content || messageText(m) }));

    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: assistantId, role: 'model', content: '', timestamp: new Date().toISOString() },
    ]);

    abortRef.current = false;

    let fullContent = '';
    let groundingData = null;
    let structuredParts = null;
    let toolCharts = [];
    let toolCalls = [];

    try {
      if (useTools) {
        // ── Function-calling path: Gemini picks tool + args, JS executes ──────
        console.log('[Chat] useTools=true | rows:', (sessionCsvRows || []).length, '| headers:', sessionCsvHeaders);
        const safeRows = Array.isArray(sessionCsvRows) ? sessionCsvRows : [];
        const safeHeaders = Array.isArray(sessionCsvHeaders) ? sessionCsvHeaders : [];
        const safeImages = Array.isArray(capturedImages) ? capturedImages : [];
        const safeImageParts = Array.isArray(imageParts) ? imageParts : [];
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = await chatWithCsvTools(
          history,
          promptForGemini,
          safeHeaders,
          (toolName, args) => executeTool(toolName, args, safeRows, safeImages),
          userContext,
          safeImageParts
        );
        fullContent = answer ?? '';
        toolCharts = Array.isArray(returnedCharts) ? returnedCharts : [];
        toolCalls = Array.isArray(returnedCalls) ? returnedCalls : [];
        console.log('[Chat] returnedCharts:', JSON.stringify(toolCharts));
        console.log('[Chat] toolCalls:', toolCalls?.map((t) => t.name) ?? []);
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: Array.isArray(toolCharts) && toolCharts.length > 0 ? toolCharts : undefined,
                  toolCalls: Array.isArray(toolCalls) && toolCalls.length > 0 ? toolCalls : undefined,
                }
              : msg
          )
        );
      } else {
        // ── Streaming path: code execution or search ─────────────────────────
        for await (const chunk of streamChat(history, promptForGemini, imageParts, useCodeExecution, userContext)) {
          if (abortRef.current) break;
          if (chunk.type === 'text') {
            fullContent += chunk.text;
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg))
            );
          } else if (chunk.type === 'fullResponse') {
            structuredParts = chunk.parts;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId ? { ...msg, content: '', parts: structuredParts } : msg
              )
            );
          } else if (chunk.type === 'grounding') {
            groundingData = chunk.data;
          }
        }
      }
    } catch (err) {
      console.error('[Chat] Error:', err);
      const errText = `Error: ${err?.message || 'Something went wrong'}`;
      setMessages((m) =>
        Array.isArray(m) ? m.map((msg) => (msg.id === assistantId ? { ...msg, content: errText } : msg)) : []
      );
      fullContent = errText;
    }

    if (groundingData) {
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, grounding: groundingData } : msg))
      );
    }

    // Save plain text + any tool charts to DB
    const savedContent = Array.isArray(structuredParts)
      ? structuredParts.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n')
      : fullContent;
    await saveMessage(
      sessionId,
      'model',
      savedContent,
      null,
      Array.isArray(toolCharts) && toolCharts.length > 0 ? toolCharts : null,
      Array.isArray(toolCalls) && toolCalls.length > 0 ? toolCalls : null
    );

    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messageCount: s.messageCount + 2 } : s))
    );

    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today · ${time}`;
    if (diffDays === 1) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  };

  const userContext = firstName || lastName ? { firstName, lastName } : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      {/* ── Sidebar ──────────────────────────────── */}
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">Chat</h1>
          <button className="new-chat-btn" onClick={handleNewChat}>
            + New Chat
          </button>
        </div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
            >
              <div className="sidebar-session-info">
                <span className="sidebar-session-title">{session.title}</span>
                <span className="sidebar-session-date">{formatDate(session.createdAt)}</span>
              </div>
              <div
                className="sidebar-session-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === session.id ? null : session.id);
                }}
              >
                <span className="three-dots">⋮</span>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button
                      className="session-delete-btn"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{username}</span>
          <button onClick={onLogout} className="sidebar-logout">
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────── */}
      <div className="chat-main">
        <div className="chat-tabs">
          <button
            className={`chat-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button
            className={`chat-tab ${activeTab === 'youtube' ? 'active' : ''}`}
            onClick={() => setActiveTab('youtube')}
          >
            YouTube Channel Download
          </button>
        </div>
        {activeTab === 'youtube' ? (
          <YouTubeDownload />
        ) : (
        <div
          ref={dropZoneRef}
          className={`chat-drop-zone${dragOver ? ' drag-over' : ''}`}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.types.includes('Files')) setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!dropZoneRef.current?.contains(e.relatedTarget)) setDragOver(false);
          }}
          onDrop={handleDrop}
        >
        <header className="chat-header">
          <h2 className="chat-header-title">{activeSession?.title ?? 'New Chat'}</h2>
        </header>

        <div className="chat-messages">
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className="chat-msg-meta">
                <span className="chat-msg-role">{m.role === 'user' ? username : 'Lisa'}</span>
                <span className="chat-msg-time">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Data file badge on user messages */}
              {(m.csvName || m.jsonName) && (
                <div className="msg-csv-badge">
                  {m.jsonName ? '📋' : '📄'} {m.jsonName || m.csvName}
                </div>
              )}

              {/* Image attachments */}
              {Array.isArray(m.images) && m.images.length > 0 && (
                <div className="chat-msg-images">
                  {m.images.filter((img) => img && img.data).map((img, i) => (
                    <img key={i} src={`data:${img.mimeType || 'image/png'};base64,${img.data}`} alt="" className="chat-msg-thumb" />
                  ))}
                </div>
              )}

              {/* Message body */}
              <div className="chat-msg-content">
                {m.role === 'model' ? (
                  m.parts ? (
                    <StructuredParts parts={m.parts} />
                  ) : m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    <span className="thinking-dots">
                      <span /><span /><span />
                    </span>
                  )
                ) : (
                  m.content
                )}
              </div>

              {/* Tool calls log */}
              {Array.isArray(m.toolCalls) && m.toolCalls.length > 0 && (
                <details className="tool-calls-details">
                  <summary className="tool-calls-summary">
                    🔧 {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''} used
                  </summary>
                  <div className="tool-calls-list">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="tool-call-item">
                        <span className="tool-call-name">{tc.name}</span>
                        <span className="tool-call-args">{JSON.stringify(tc.args)}</span>
                        {tc.result && !tc.result._chartType && (
                          <span className="tool-call-result">
                            → {JSON.stringify(tc.result).slice(0, 200)}
                            {JSON.stringify(tc.result).length > 200 ? '…' : ''}
                          </span>
                        )}
                        {tc.result?._chartType && (
                          <span className="tool-call-result">→ rendered chart</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Charts from tool calls */}
              {Array.isArray(m.charts) && m.charts.map((chart, ci) =>
                chart && chart._chartType === 'engagement' ? (
                  <div key={ci} className="chart-wrap" onClick={() => setEnlargedItem({ type: 'engagement', chart })}>
                    <EngagementChart data={chart.data} metricColumn={chart.metricColumn} />
                  </div>
                ) : chart && chart._chartType === 'metric_vs_time' ? (
                  <div key={ci} className="chart-wrap" onClick={() => setEnlargedItem({ type: 'metric_vs_time', chart })}>
                    <MetricVsTimeChart data={chart.data} metricColumn={chart.metricColumn} />
                  </div>
                ) : chart && chart._chartType === 'generated_image' ? (
                  <div key={ci} className="generated-image-wrap">
                    <img
                      src={`data:${chart.mimeType || 'image/png'};base64,${chart.data}`}
                      alt="Generated"
                      className="part-image clickable-image"
                      onClick={() => setEnlargedItem({ type: 'image', mimeType: chart.mimeType, data: chart.data })}
                    />
                    <a
                      href={`data:${chart.mimeType || 'image/png'};base64,${chart.data}`}
                      download="generated-image.png"
                      className="image-download-btn"
                    >
                      ↓ Download
                    </a>
                  </div>
                ) : null
              )}

              {/* Video cards from play_video tool */}
              {Array.isArray(m.toolCalls) && m.toolCalls.filter((tc) => tc?.result?._openUrl).map((tc, i) => (
                <a
                  key={i}
                  href={tc.result._openUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="video-card"
                >
                  {tc.result.thumbnailUrl && (
                    <img src={tc.result.thumbnailUrl} alt="" className="video-card-thumb" />
                  )}
                  <div className="video-card-body">
                    <span className="video-card-title">▶ {tc.result.title || 'Watch video'}</span>
                  </div>
                </a>
              ))}

              {/* Search sources */}
              {m.grounding?.groundingChunks?.length > 0 && (
                <div className="chat-msg-sources">
                  <span className="sources-label">Sources</span>
                  <div className="sources-list">
                    {m.grounding.groundingChunks.map((chunk, i) =>
                      chunk.web ? (
                        <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="source-link">
                          {chunk.web.title || chunk.web.uri}
                        </a>
                      ) : null
                    )}
                  </div>
                  {m.grounding.webSearchQueries?.length > 0 && (
                    <div className="sources-queries">
                      Searched: {m.grounding.webSearchQueries.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {dragOver && <div className="chat-drop-overlay">Drop CSV, JSON, or images here</div>}

        {/* ── Input area ── */}
        <div className="chat-input-area">
          {/* CSV chip */}
          {(csvContext || jsonContext) && (
            <div className="csv-chip">
              <span className="csv-chip-icon">{jsonContext ? '📋' : '📄'}</span>
              <span className="csv-chip-name">{(jsonContext || csvContext).name}</span>
              <span className="csv-chip-meta">
                {jsonContext
                  ? `${jsonContext.videoCount} videos`
                  : `${csvContext?.rowCount ?? 0} rows · ${(csvContext?.headers || []).length} cols`}
              </span>
              <button
                className="csv-chip-remove"
                onClick={() => { setCsvContext(null); setJsonContext(null); setSessionCsvRows(null); setSessionCsvHeaders(null); }}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          )}

          {/* Image previews */}
          {Array.isArray(images) && images.length > 0 && (
            <div className="chat-image-previews">
              {images.filter((img) => img && img.data).map((img, i) => (
                <div key={i} className="chat-img-preview">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button type="button" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden file picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.csv,text/csv,.json,application/json"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <div className="chat-input-row">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              title="Attach image or CSV"
            >
              📎
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask a question, request analysis, or write & run code…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              onPaste={handlePaste}
              disabled={streaming}
            />
            {streaming ? (
              <button onClick={handleStop} className="stop-btn">
                ■ Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && !images.length && !csvContext && !jsonContext}
              >
                Send
              </button>
            )}
          </div>
        </div>
        </div>
        )}

        {/* Enlarge overlay */}
        {enlargedItem && (
          <div className="enlarge-overlay" onClick={() => setEnlargedItem(null)}>
            <div onClick={(e) => e.stopPropagation()}>
              {enlargedItem.type === 'image' && (
                <>
                  <img src={`data:${enlargedItem.mimeType || 'image/png'};base64,${enlargedItem.data}`} alt="Enlarged" />
                  <div className="enlarge-actions">
                    <a
                      href={`data:${enlargedItem.mimeType || 'image/png'};base64,${enlargedItem.data}`}
                      download="image.png"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button>Download</button>
                    </a>
                    <button onClick={() => setEnlargedItem(null)}>Close</button>
                  </div>
                </>
              )}
              {enlargedItem.type === 'engagement' && (
                <div className="enlarge-chart-container" ref={chartExportRef}>
                  <EngagementChart data={enlargedItem.chart.data} metricColumn={enlargedItem.chart.metricColumn} enlarged />
                  <div className="enlarge-actions">
                    <button onClick={downloadChartAsPng}>Download</button>
                    <button onClick={() => setEnlargedItem(null)}>Close</button>
                  </div>
                </div>
              )}
              {enlargedItem.type === 'metric_vs_time' && (
                <div className="enlarge-chart-container" ref={chartExportRef}>
                  <MetricVsTimeChart data={enlargedItem.chart.data} metricColumn={enlargedItem.chart.metricColumn} enlarged />
                  <div className="enlarge-actions">
                    <button onClick={downloadChartAsPng}>Download</button>
                    <button onClick={() => setEnlargedItem(null)}>Close</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
