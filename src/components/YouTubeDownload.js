import { useState } from 'react';
import { downloadChannelData } from '../services/youtubeApi';
import './YouTubeDownload.css';

export default function YouTubeDownload() {
  const [channelUrl, setChannelUrl] = useState('https://www.youtube.com/@veritasium');
  const [maxVideos, setMaxVideos] = useState(10);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadName, setDownloadName] = useState('');

  const handleDownload = async () => {
    setError('');
    setDownloadUrl(null);
    setLoading(true);
    setProgress(0);
    setProgressMsg('Starting...');
    try {
      const data = await downloadChannelData(
        channelUrl,
        Math.min(Math.max(maxVideos, 1), 100),
        (pct, msg) => {
          setProgress(pct);
          setProgressMsg(msg);
        }
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadName(`channel-data-${Date.now()}.json`);
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setLoading(false);
      setProgress(100);
      setProgressMsg('Done');
    }
  };

  return (
    <div className="youtube-download">
      <h2 className="youtube-download-title">YouTube Channel Download</h2>
      <p className="youtube-download-desc">
        Enter a YouTube channel URL to download video metadata including title, description, transcript, duration, stats, and more.
      </p>
      <div className="youtube-download-form">
        <input
          type="url"
          placeholder="https://www.youtube.com/@channelname"
          value={channelUrl}
          onChange={(e) => setChannelUrl(e.target.value)}
          disabled={loading}
        />
        <div className="youtube-download-row">
          <label>
            Max videos: <input
              type="number"
              min={1}
              max={100}
              value={maxVideos}
              onChange={(e) => setMaxVideos(parseInt(e.target.value, 10) || 10)}
              disabled={loading}
            />
          </label>
          <button onClick={handleDownload} disabled={loading}>
            {loading ? 'Downloading...' : 'Download Channel Data'}
          </button>
        </div>
      </div>
      {loading && (
        <div className="youtube-download-progress">
          <div className="youtube-progress-bar">
            <div className="youtube-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="youtube-progress-msg">{progressMsg}</span>
        </div>
      )}
      {error && <p className="youtube-download-error">{error}</p>}
      {downloadUrl && !loading && (
        <a
          href={downloadUrl}
          download={downloadName}
          className="youtube-download-link"
        >
          ↓ Download JSON file
        </a>
      )}
    </div>
  );
}
