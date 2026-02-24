const API = process.env.REACT_APP_API_URL || '';

export async function downloadChannelData(channelUrl, maxVideos, onProgress) {
  const res = await fetch(`${API}/api/youtube-download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl, maxVideos }),
  });
  if (!res.ok) throw new Error(await res.text());

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'progress' && onProgress) onProgress(obj.progress, obj.message);
        if (obj.type === 'complete') result = obj.data;
        if (obj.type === 'error') throw new Error(obj.error);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  if (buffer.trim()) {
    const obj = JSON.parse(buffer);
    if (obj.type === 'complete') result = obj.data;
    if (obj.type === 'error') throw new Error(obj.error);
  }
  return result;
}
