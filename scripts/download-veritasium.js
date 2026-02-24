#!/usr/bin/env node
/**
 * Pre-download 10 videos from Veritasium channel and save to public/veritasium-channel-data.json
 * Run: node scripts/download-veritasium.js
 * Requires YOUTUBE_API_KEY in .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { downloadChannelData } = require('../server/youtubeDownload');

const CHANNEL_URL = 'https://www.youtube.com/@veritasium';
const MAX_VIDEOS = 10;
const OUTPUT_PATH = path.join(__dirname, '../public/veritasium-channel-data.json');

async function main() {
  console.log('Downloading', MAX_VIDEOS, 'videos from', CHANNEL_URL, '...');
  const data = await downloadChannelData(CHANNEL_URL, MAX_VIDEOS, (pct, msg) => {
    console.log(`[${pct}%] ${msg}`);
  });
  const json = JSON.stringify({ videos: data }, null, 2);
  fs.writeFileSync(OUTPUT_PATH, json, 'utf8');
  console.log('Saved to', OUTPUT_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
