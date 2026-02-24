// ── Tool declarations (sent to Gemini so it knows what functions exist) ───────

// IMPORTANT NOTE embedded in every description:
// The user message always begins with "[CSV columns: col1, col2, ...]".
// Always copy column names character-for-character from that list.
// Never guess, abbreviate, or change capitalisation.

const COL_NOTE = 'Use the exact column name as it appears in the [CSV columns: ...] header at the top of the message — copy it character-for-character, preserving spaces and capitalisation.';

export const CSV_TOOL_DECLARATIONS = [
  {
    name: 'compute_column_stats',
    description:
      'Compute descriptive statistics (mean, median, std, min, max, count) for a numeric column. ' + COL_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        column: {
          type: 'STRING',
          description: 'Exact column name copied from [CSV columns: ...]. Example: if the header says "Favorite Count" pass "Favorite Count", not "favorite_count".',
        },
      },
      required: ['column'],
    },
  },
  {
    name: 'get_value_counts',
    description:
      'Count occurrences of each unique value in a column (for categorical data). ' + COL_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        column: {
          type: 'STRING',
          description: 'Exact column name copied from [CSV columns: ...]. ' + COL_NOTE,
        },
        top_n: { type: 'NUMBER', description: 'How many top values to return (default 10)' },
      },
      required: ['column'],
    },
  },
  {
    name: 'get_top_tweets',
    description:
      'Return the top or bottom N tweets sorted by any metric, including the computed "engagement" column ' +
      '(Favorite Count / View Count). Returns tweet text + all key metrics in a readable format. ' +
      'Use this when someone asks for the best/worst/most/least performing tweets, ' +
      'e.g. "show me the 10 most engaging tweets" or "what are the least viewed tweets". ' +
      'The "engagement" column is always available once a CSV is loaded.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sort_column: {
          type: 'STRING',
          description: 'Metric to sort by. Use "engagement" for engagement ratio, or any exact column name from [CSV columns: ...].',
        },
        n: { type: 'NUMBER', description: 'Number of tweets to return (default 10).' },
        ascending: {
          type: 'BOOLEAN',
          description: 'false = highest first (top performers), true = lowest first (worst performers). Default false.',
        },
      },
      required: ['sort_column'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description:
      'Plot any numeric field (views, likes, comments, viewCount, likeCount, etc.) vs time for channel videos. ' +
      'The plot is rendered as a React chart component directly in the chat — click to enlarge, download as PNG. ' +
      'Use when the user asks to visualize how a metric changes over time, e.g. "plot views over time" or "show likes vs date". ' +
      'Requires a date/time column (e.g. publishedAt, createdAt, date) and a numeric metric column. ' + COL_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        metric_column: {
          type: 'STRING',
          description: 'Exact column name for the numeric metric to plot (views, likes, comments, viewCount, etc.). ' + COL_NOTE,
        },
        date_column: {
          type: 'STRING',
          description: 'Exact column name for the date/time field. Common names: publishedAt, createdAt, date, timestamp. ' + COL_NOTE,
        },
      },
      required: ['metric_column', 'date_column'],
    },
  },
  {
    name: 'play_video',
    description:
      'Open a video from the channel data in a new tab. Use when the user wants to play, watch, or open a video. ' +
      'NEVER ask the user for the URL — always look up the video from the loaded channel data. ' +
      'User can specify by title (search_by_title), ordinal (ordinal: 1 = first video), or most viewed (most_viewed: true). ' +
      'When user says "play the asbestos video": pass search_by_title: "asbestos". ' +
      'When user says "play the most viewed video": pass most_viewed: true. ' +
      'When user says "play the first video": pass ordinal: 1.',
    parameters: {
      type: 'OBJECT',
      properties: {
        video_url: {
          type: 'STRING',
          description: 'Full video URL or YouTube video ID. Use when you have it from the data. Omit if using search_by_title, most_viewed, or ordinal.',
        },
        search_by_title: {
          type: 'STRING',
          description: 'Keyword to search for in video titles (e.g. "asbestos"). Use when user says "play the X video".',
        },
        most_viewed: {
          type: 'BOOLEAN',
          description: 'If true, play the video with the highest view count. Use when user says "play the most viewed video".',
        },
        ordinal: {
          type: 'NUMBER',
          description: 'Play the Nth video (1 = first, 2 = second, etc.). Use when user says "play the first video" or "play the 3rd video".',
        },
        title: {
          type: 'STRING',
          description: 'Video title for the clickable card display.',
        },
        thumbnail_url: {
          type: 'STRING',
          description: 'URL of the video thumbnail image for the card.',
        },
      },
      required: [],
    },
  },
  {
    name: 'compute_stats_json',
    description:
      'Compute mean, median, std, min, max for any numeric field in channel JSON/CSV data. ' +
      'Works on flat or nested field paths (e.g. "viewCount" or "stats.views"). ' +
      'Use when the user asks for statistics on a numeric column. ' + COL_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        field: {
          type: 'STRING',
          description: 'Exact field/column name for the numeric values. Use the exact name from [CSV columns: ...].',
        },
      },
      required: ['field'],
    },
  },
  {
    name: 'generateImage',
    description:
      'Generate an image from a text prompt, optionally using an anchor/reference image. ' +
      'Use when the user asks to create, generate, or draw an image. ' +
      'CRITICAL: Pass a DETAILED prompt with comma-separated descriptors (e.g. "professional editorial photography, man in navy blue suit, Paris street, Eiffel Tower background, golden hour lighting, high fashion"). ' +
      'Include all specific details the user requested: location, clothing, style, lighting, mood. Do NOT use short vague prompts.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'Detailed description of the desired image. Use comma-separated descriptors. Example: "professional photography, woman in red dress, Tokyo street at night, neon lights, cinematic, 8k"',
        },
      },
      required: ['prompt'],
    },
  },
];

// ── Parse a CSV line, respecting quoted fields ────────────────────────────────

const parseLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
};

// ── Parse a full CSV text into an array of row objects ────────────────────────

export const parseCsvToRows = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (vals[i] || '').replace(/^"|"$/g, '');
    });
    return obj;
  });
  return { headers, rows };
};

// ── Column lookup (case-insensitive + whitespace-tolerant) ───────────────────
// Gemini often passes column names in a slightly different case than the CSV header.
// This finds the actual header key so the lookup always works.

const resolveCol = (rows, name) => {
  if (!rows.length || !name) return name;
  const keys = Object.keys(rows[0]);
  // 1. exact match
  if (keys.includes(name)) return name;
  const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(name);
  // 2. normalised match
  return keys.find((k) => norm(k) === target) || name;
};

// ── Math helpers ──────────────────────────────────────────────────────────────

const numericValues = (rows, col) =>
  rows.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));

const median = (sorted) =>
  sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

const fmt = (n) => +n.toFixed(4);

// ── Build a slim CSV with only the key analytical columns ────────────────────
// Extracts text, language, type, engagement metrics, and the computed engagement
// ratio. Returns a plain CSV string Gemini can read directly in its context —
// no base64 or Python needed. ~6-10k tokens for a 250-row tweet dataset.

const SLIM_PATTERNS = [
  /^text$/i,
  /^language$/i,
  /^type$/i,
  /^view.?count$/i,
  /^reply.?count$/i,
  /^retweet.?count$/i,
  /^quote.?count$/i,
  /^favorite.?count$/i,
  /^(created.?at|timestamp|date)$/i,
  /^engagement$/i,            // computed column added by enrichWithEngagement
];

export const buildSlimCsv = (rows, headers) => {
  if (!rows.length || !headers.length) return '';

  // Pick columns that match any slim pattern, preserving header order
  const slimHeaders = headers.filter((h) => SLIM_PATTERNS.some((re) => re.test(h)));
  if (!slimHeaders.length) return '';

  const escapeCell = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [
    slimHeaders.join(','),
    ...rows.map((r) => slimHeaders.map((h) => escapeCell(r[h])).join(',')),
  ];
  return lines.join('\n');
};

// ── Enrich rows with computed engagement column ───────────────────────────────
// Adds engagement = Favorite Count / View Count to every row.
// Returns { rows: enrichedRows, headers: updatedHeaders }.
// Safe to call even if the columns aren't present (skips gracefully).

export const enrichWithEngagement = (rows, headers) => {
  if (!rows.length) return { rows, headers };

  // Auto-detect favorite and view columns
  const favCol =
    headers.find((h) => /favorite.?count/i.test(h)) ||
    headers.find((h) => /^likes?$/i.test(h));
  const viewCol =
    headers.find((h) => /view.?count/i.test(h)) ||
    headers.find((h) => /^views?$/i.test(h));

  if (!favCol || !viewCol) return { rows, headers };
  if (headers.includes('engagement')) return { rows, headers }; // already added

  const enriched = rows.map((r) => {
    const fav  = parseFloat(r[favCol]);
    const view = parseFloat(r[viewCol]);
    const eng  = !isNaN(fav) && !isNaN(view) && view > 0
      ? +(fav / view).toFixed(6)
      : null;
    return { ...r, engagement: eng };
  });

  return { rows: enriched, headers: [...headers, 'engagement'] };
};

// ── Dataset summary (auto-computed when CSV is loaded) ───────────────────────
// Returns a compact markdown string describing every column so Gemini always
// has exact column names, types, and value distributions in its context.

export const computeDatasetSummary = (rows, headers) => {
  if (!rows.length || !headers.length) return '';

  const lines = [`**Dataset: ${rows.length} rows × ${headers.length} columns**\n`];
  const numericCols = [];
  const categoricalCols = [];

  headers.forEach((h) => {
    const vals = rows.map((r) => r[h]).filter((v) => v !== '' && v !== undefined && v !== null);
    const numVals = vals.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
    const numericRatio = numVals.length / (vals.length || 1);

    if (numericRatio >= 0.8 && numVals.length > 0) {
      const mean = numVals.reduce((a, b) => a + b, 0) / numVals.length;
      numericCols.push({
        name: h,
        count: numVals.length,
        mean: +mean.toFixed(2),
        min: Math.min(...numVals),
        max: Math.max(...numVals),
      });
    } else {
      const counts = {};
      vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([v, n]) => `${v} (${n})`)
        .join(', ');
      categoricalCols.push({ name: h, unique: Object.keys(counts).length, top });
    }
  });

  if (numericCols.length) {
    lines.push('**Numeric columns** (exact names — use these verbatim in tool calls):');
    numericCols.forEach((c) => {
      lines.push(`  • "${c.name}": mean=${c.mean}, min=${c.min}, max=${c.max}, n=${c.count}`);
    });
  }

  if (categoricalCols.length) {
    lines.push('\n**Categorical columns** (exact names — use these verbatim in tool calls):');
    categoricalCols.forEach((c) => {
      lines.push(`  • "${c.name}": ${c.unique} unique values — top: ${c.top}`);
    });
  }

  return lines.join('\n');
};

// ── Client-side tool executor ─────────────────────────────────────────────────
// Returns a Promise for async tools (generateImage), plain object for sync tools.

const API = process.env.REACT_APP_API_URL || '';

export const executeTool = async (toolName, args, rows, attachedImages = []) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeImages = Array.isArray(attachedImages) ? attachedImages : [];
  const firstRow = safeRows.length > 0 ? safeRows[0] : null;
  const availableHeaders = firstRow && typeof firstRow === 'object' ? Object.keys(firstRow) : [];
  console.group(`[CSV Tool] ${toolName}`);
  console.log('args:', args);
  console.log('rows loaded:', safeRows.length);
  console.log('available headers:', availableHeaders);
  console.groupEnd();

  switch (toolName) {
    case 'compute_column_stats': {
      const col = resolveCol(safeRows, args.column);
      console.log(`[compute_column_stats] resolved column: "${args.column}" → "${col}"`);
      const vals = numericValues(safeRows, col);
      if (!vals.length)
        return { error: `No numeric values found in column "${col}". Available columns: ${availableHeaders.join(', ')}` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        column: col,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'get_value_counts': {
      const col = resolveCol(safeRows, args.column);
      console.log(`[get_value_counts] resolved column: "${args.column}" → "${col}"`);
      const topN = args.top_n || 10;
      const counts = {};
      safeRows.forEach((r) => {
        const v = r[col];
        if (v !== undefined && v !== '') counts[v] = (counts[v] || 0) + 1;
      });
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
      return {
        column: col,
        total_rows: safeRows.length,
        value_counts: Object.fromEntries(sorted),
      };
    }

    case 'get_top_tweets': {
      const sortCol = resolveCol(safeRows, args.sort_column) || args.sort_column;
      console.log(`[get_top_tweets] sort="${sortCol}" n=${args.n} asc=${args.ascending}`);
      const n   = args.n || 10;
      const asc = args.ascending ?? false;

      // Detect text column for display
      const textCol =
        availableHeaders.find((h) => /^text$/i.test(h)) ||
        availableHeaders.find((h) => /text|content|tweet|body/i.test(h));

      // Detect key metric columns
      const favCol  = availableHeaders.find((h) => /favorite.?count/i.test(h));
      const viewCol = availableHeaders.find((h) => /view.?count/i.test(h));
      const engCol  = availableHeaders.includes('engagement') ? 'engagement' : null;

      const sorted = [...safeRows].sort((a, b) => {
        const av = parseFloat(a[sortCol]);
        const bv = parseFloat(b[sortCol]);
        if (!isNaN(av) && !isNaN(bv)) return asc ? av - bv : bv - av;
        return 0;
      });

      const topRows = sorted.slice(0, n).map((r, i) => {
        const out = { rank: i + 1 };
        if (textCol) out.text = String(r[textCol] || '').slice(0, 150);
        if (favCol)  out[favCol]  = r[favCol];
        if (viewCol) out[viewCol] = r[viewCol];
        if (engCol)  out.engagement = r.engagement;
        return out;
      });

      if (!topRows.length)
        return { error: `No rows found. Column "${sortCol}" may not exist. Available: ${availableHeaders.join(', ')}` };

      return {
        sort_column: sortCol,
        direction: asc ? 'ascending (lowest first)' : 'descending (highest first)',
        count: topRows.length,
        tweets: topRows,
      };
    }

    case 'plot_metric_vs_time': {
      if (!safeRows.length)
        return { error: 'No channel data loaded. Please drag and drop a JSON file with your YouTube channel data first, then ask to plot.' };
      const metricCol = resolveCol(safeRows, args.metric_column);
      const dateCol = resolveCol(safeRows, args.date_column);
      const vals = safeRows
        .map((r) => {
          const dateVal = r[dateCol];
          const numVal = parseFloat(r[metricCol]);
          if (!dateVal || isNaN(numVal)) return null;
          const d = new Date(dateVal);
          if (isNaN(d.getTime())) return null;
          return { date: dateVal, parsed: d.getTime(), value: numVal };
        })
        .filter(Boolean);
      if (!vals.length)
        return { error: `No valid date+metric pairs. Check columns "${metricCol}" and "${dateCol}". Available: ${availableHeaders.join(', ')}` };
      vals.sort((a, b) => a.parsed - b.parsed);
      const chartData = vals.map((v) => ({
        date: v.date,
        value: v.value,
        label: new Date(v.parsed).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' }),
      }));
      return {
        _chartType: 'metric_vs_time',
        data: chartData,
        metricColumn: metricCol,
        dateColumn: dateCol,
      };
    }

    case 'play_video': {
      let url = String(args.video_url || '').trim();
      let displayTitle = args.title || 'Watch video';
      let thumbnailUrl = args.thumbnail_url || null;

      const titleCol =
        availableHeaders.find((h) => /^title$/i.test(h)) ||
        availableHeaders.find((h) => /title|name|videoTitle|text/i.test(h));
      const urlCol =
        availableHeaders.find((h) => /^videoUrl$/i.test(h)) ||
        availableHeaders.find((h) => /videoUrl|video_url|url/i.test(h));
      const idCol =
        availableHeaders.find((h) => /^videoId$/i.test(h)) ||
        availableHeaders.find((h) => /videoId|video_id|id/i.test(h));
      const viewCol =
        availableHeaders.find((h) => /^viewCount$/i.test(h)) ||
        availableHeaders.find((h) => /viewCount|view.?count|views/i.test(h));
      const thumbCol = availableHeaders.find((h) => /thumbnail/i.test(h));

      const pickMatch = (match) => {
        if (!match) return;
        const rawUrl = match[urlCol] || match[idCol];
        if (rawUrl) {
          url = String(rawUrl).trim();
          displayTitle = (titleCol && match[titleCol]) ? String(match[titleCol]) : displayTitle;
          if (thumbCol && match[thumbCol]) thumbnailUrl = String(match[thumbCol]);
        }
      };

      if (!url && args.search_by_title) {
        const searchTerm = String(args.search_by_title).trim().toLowerCase();
        if (!searchTerm) return { error: 'search_by_title cannot be empty' };
        if (!titleCol)
          return { error: 'No title column found in channel data. Available: ' + availableHeaders.join(', ') };
        const match = safeRows.find((r) => {
          const t = String(r[titleCol] || '').toLowerCase();
          return t.includes(searchTerm);
        });
        if (!match)
          return { error: `No video found with "${args.search_by_title}" in the title. Try a different keyword.` };
        pickMatch(match);
      } else if (!url && args.most_viewed) {
        if (!viewCol)
          return { error: 'No view count column found. Available: ' + availableHeaders.join(', ') };
        const sorted = [...safeRows].sort((a, b) => {
          const av = parseFloat(a[viewCol]) || 0;
          const bv = parseFloat(b[viewCol]) || 0;
          return bv - av;
        });
        pickMatch(sorted[0]);
      } else if (!url && typeof args.ordinal === 'number' && args.ordinal >= 1) {
        const idx = Math.floor(args.ordinal) - 1;
        const match = safeRows[idx];
        if (!match)
          return { error: `There is no ${args.ordinal}${args.ordinal === 1 ? 'st' : args.ordinal === 2 ? 'nd' : args.ordinal === 3 ? 'rd' : 'th'} video. Only ${safeRows.length} video(s) in the data.` };
        pickMatch(match);
      }

      if (!url) return { error: 'Provide video_url, search_by_title, most_viewed: true, or ordinal to find the video in the loaded data.' };
      if (!/^https?:\/\//i.test(url)) {
        url = `https://www.youtube.com/watch?v=${url}`;
      }
      return {
        _openUrl: url,
        title: displayTitle,
        thumbnailUrl,
      };
    }

    case 'compute_stats_json': {
      const field = resolveCol(safeRows, args.field);
      const vals = numericValues(safeRows, field);
      if (!vals.length)
        return { error: `No numeric values in field "${field}". Available: ${availableHeaders.join(', ')}` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        field,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'generateImage': {
      try {
        const anchorBase64 = safeImages[0] && safeImages[0].data ? safeImages[0].data : null;
        const mimeType = safeImages[0]?.mimeType || 'image/jpeg';
        let res;
        if (anchorBase64) {
          try {
            const form = new FormData();
            form.append('prompt', args.prompt || '');
            let raw = String(anchorBase64).replace(/^data:image\/\w+;base64,/, '').replace(/\s/g, '');
            const pad = raw.length % 4;
            if (pad) raw += '='.repeat(4 - pad);
            const bin = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
            const blobType = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
            form.append('anchor_image', new Blob([bin], { type: blobType }), 'anchor.jpg');
            res = await fetch(`${API}/api/generate-image`, { method: 'POST', body: form });
          } catch (formErr) {
            res = await fetch(`${API}/api/generate-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: args.prompt }),
            });
          }
        } else {
          res = await fetch(`${API}/api/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: args.prompt }),
          });
        }
        const text = await res.text();
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (parseErr) {
          return { error: `Server returned invalid response (${res.status}). Try again or use text-only generation.` };
        }
        if (!res.ok) return { error: data.error || 'Image generation failed' };
        if (data.image_base64) {
          return { _chartType: 'generated_image', mimeType: data.mimeType || 'image/png', data: data.image_base64 };
        }
        return { error: 'No image returned from server' };
      } catch (err) {
        return { error: `Image generation failed: ${err.message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
};
