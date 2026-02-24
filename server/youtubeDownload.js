const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');

function parseChannelUrl(url) {
  const str = String(url || '').trim();
  // https://www.youtube.com/@veritasium
  const handleMatch = str.match(/youtube\.com\/@([a-zA-Z0-9_]+)/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };
  // https://www.youtube.com/channel/UCxxxx
  const channelMatch = str.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/);
  if (channelMatch) return { type: 'channelId', value: channelMatch[1] };
  // https://www.youtube.com/c/veritasium
  const customMatch = str.match(/youtube\.com\/c\/([a-zA-Z0-9_]+)/);
  if (customMatch) return { type: 'custom', value: customMatch[1] };
  return null;
}

async function getChannelId(youtube, parsed) {
  if (parsed.type === 'channelId') return parsed.value;
  if (parsed.type === 'handle') {
    const res = await youtube.channels.list({
      part: 'id',
      forHandle: parsed.value,
    });
    const id = res.data?.items?.[0]?.id;
    if (id) return id;
  }
  // Fallback: search for channel
  const res = await youtube.search.list({
    part: 'snippet',
    q: parsed.value,
    type: 'channel',
    maxResults: 1,
  });
  return res.data?.items?.[0]?.snippet?.channelId || null;
}

async function getUploadsPlaylistId(youtube, channelId) {
  const res = await youtube.channels.list({
    part: 'contentDetails',
    id: channelId,
  });
  return res.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
}

async function getVideoIds(youtube, playlistId, maxResults) {
  const ids = [];
  let nextPageToken = null;
  while (ids.length < maxResults) {
    const res = await youtube.playlistItems.list({
      part: 'contentDetails',
      playlistId,
      maxResults: Math.min(50, maxResults - ids.length),
      pageToken: nextPageToken,
    });
    const items = res.data?.items || [];
    for (const item of items) {
      if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
    }
    nextPageToken = res.data?.nextPageToken;
    if (!nextPageToken || items.length === 0) break;
  }
  return ids.slice(0, maxResults);
}

async function getVideoDetails(youtube, videoIds) {
  if (videoIds.length === 0) return [];
  const res = await youtube.videos.list({
    part: 'snippet,contentDetails,statistics',
    id: videoIds.join(','),
  });
  return (res.data?.items || []).map((v) => {
    const s = v.snippet || {};
    const c = v.contentDetails || {};
    const t = v.statistics || {};
    return {
      videoId: v.id,
      title: s.title || '',
      description: s.description || '',
      duration: c.duration || '',
      publishedAt: s.publishedAt || '',
      viewCount: parseInt(t.viewCount || '0', 10),
      likeCount: parseInt(t.likeCount || '0', 10),
      commentCount: parseInt(t.commentCount || '0', 10),
      thumbnailUrl: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || s.thumbnails?.default?.url || '',
      videoUrl: `https://www.youtube.com/watch?v=${v.id}`,
    };
  });
}

async function getTranscript(videoId) {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    return transcript.map((t) => t.text).join(' ');
  } catch {
    return null;
  }
}

function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || '0', 10);
  const m = parseInt(match[2] || '0', 10);
  const s = parseInt(match[3] || '0', 10);
  return h * 3600 + m * 60 + s;
}

module.exports = {
  async downloadChannelData(channelUrl, maxVideos, onProgress) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured in .env');

    const youtube = google.youtube({ version: 'v3', auth: apiKey });
    const parsed = parseChannelUrl(channelUrl);
    if (!parsed) throw new Error('Invalid YouTube channel URL');

    if (onProgress) onProgress(0, 'Resolving channel...');
    const channelId = await getChannelId(youtube, parsed);
    if (!channelId) throw new Error('Could not find channel');

    if (onProgress) onProgress(5, 'Fetching video list...');
    const playlistId = await getUploadsPlaylistId(youtube, channelId);
    if (!playlistId) throw new Error('Could not find uploads playlist');

    const videoIds = await getVideoIds(youtube, playlistId, maxVideos);
    if (videoIds.length === 0) throw new Error('No videos found');

    if (onProgress) onProgress(15, 'Fetching video details...');
    const videos = await getVideoDetails(youtube, videoIds);

    const total = videos.length;
    const result = [];

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const pct = 15 + Math.floor((i / total) * 80);
      if (onProgress) onProgress(pct, `Fetching transcript ${i + 1}/${total}: ${v.title?.slice(0, 30)}...`);
      const transcript = await getTranscript(v.videoId);
      result.push({
        ...v,
        transcript: transcript || '',
        durationSeconds: parseDuration(v.duration),
      });
    }

    if (onProgress) onProgress(100, 'Done');
    return result;
  },
};
