/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Marks a YouTube video as watched on the signed-in account by replaying the
 * tracking pings the player sends at the end of playback (the same technique
 * as `yt-dlp --mark-watched`). The video then shows up in the watch history.
 *
 * Loaded both as a content script (exposes globalThis.YtSawIt) and from Node
 * for tests (module.exports).
 */
(function (root) {
  'use strict';

  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const CPN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  const DEFAULT_ORIGIN = 'https://www.youtube.com';

  // `code` is one of: page-unavailable, not-logged-in, no-player-data,
  // no-tracking, ping-rejected. `status` is the HTTP status when relevant.
  class MarkWatchedError extends Error {
    constructor(code, status) {
      super(status === undefined ? code : `${code} (HTTP ${status})`);
      this.name = 'MarkWatchedError';
      this.code = code;
      this.status = status;
    }
  }

  function parseVideoId(url, base = DEFAULT_ORIGIN) {
    let u;
    try {
      u = new URL(url, base);
    } catch {
      return null;
    }
    let id = null;
    if (u.hostname === 'youtu.be') {
      id = u.pathname.split('/')[1];
    } else if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === '/watch') {
        id = u.searchParams.get('v');
      } else {
        const m = u.pathname.match(/^\/(?:shorts|live)\/([^/]+)/);
        if (m) id = m[1];
      }
    }
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  // Returns the text of the JSON object starting at text[start] === '{'.
  function sliceJsonObject(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}' && --depth === 0) {
        return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function extractPlayerResponse(html) {
    const marker = /ytInitialPlayerResponse\s*=\s*\{/g;
    let m;
    while ((m = marker.exec(html))) {
      const json = sliceJsonObject(html, m.index + m[0].length - 1);
      if (!json) continue;
      try {
        return JSON.parse(json);
      } catch {
        // Not the assignment we are looking for: keep scanning.
      }
    }
    return null;
  }

  function isLoggedIn(html) {
    return /"LOGGED_IN"\s*:\s*true/.test(html);
  }

  function generateCpn(random = Math.random) {
    let cpn = '';
    for (let i = 0; i < 16; i++) cpn += CPN_ALPHABET[Math.floor(random() * 64) & 63];
    return cpn;
  }

  // Builds [playbackUrl, watchtimeUrl] simulating a full playback.
  function buildTrackingUrls(player, { origin = DEFAULT_ORIGIN, cpn }) {
    const tracking = player && player.playbackTracking;
    const bases = [
      tracking && tracking.videostatsPlaybackUrl && tracking.videostatsPlaybackUrl.baseUrl,
      tracking && tracking.videostatsWatchtimeUrl && tracking.videostatsWatchtimeUrl.baseUrl,
    ];
    if (!bases[0] || !bases[1]) throw new MarkWatchedError('no-tracking');

    const target = new URL(origin);
    return bases.map((base, i) => {
      const url = new URL(base);
      // Same origin as the page, so cookies are sent and the response is readable.
      url.protocol = target.protocol;
      url.host = target.host;

      const length = Number(url.searchParams.get('len')) ||
        Number(player.videoDetails && player.videoDetails.lengthSeconds) || 1.5;
      const position = String(Math.max(length - 1, 0));

      url.searchParams.set('ver', '2');
      url.searchParams.set('cpn', cpn);
      url.searchParams.set('cmt', position);
      url.searchParams.set('el', 'detailpage');
      if (i === 1) {
        url.searchParams.set('st', '0');
        url.searchParams.set('et', position);
      }
      return url.toString();
    });
  }

  async function markWatched(videoId, { fetch: doFetch, origin = DEFAULT_ORIGIN, random } = {}) {
    const init = { credentials: 'include' };

    const page = await doFetch(`${origin}/watch?v=${encodeURIComponent(videoId)}`, init);
    if (!page.ok) throw new MarkWatchedError('page-unavailable', page.status);
    const html = await page.text();

    if (!isLoggedIn(html)) throw new MarkWatchedError('not-logged-in');
    const player = extractPlayerResponse(html);
    if (!player) throw new MarkWatchedError('no-player-data');

    for (const url of buildTrackingUrls(player, { origin, cpn: generateCpn(random) })) {
      const res = await doFetch(url, init);
      if (!res.ok) throw new MarkWatchedError('ping-rejected', res.status);
    }

    return { videoId, title: player.videoDetails && player.videoDetails.title };
  }

  // A player already open on this video keeps reporting its real position and
  // would overwrite ours (YouTube keeps the latest). Moving it to the end makes
  // it report "watched to the end" too. `players` are YouTube player APIs
  // (#movie_player, #shorts-player). Returns true if one was moved.
  function finishPlayback(players, videoId) {
    let finished = false;
    for (const player of players) {
      try {
        const data = player && player.getVideoData && player.getVideoData();
        if (!data || data.video_id !== videoId || data.isLive) continue;
        const duration = Number(player.getDuration());
        if (!Number.isFinite(duration) || duration <= 0) continue;
        player.seekTo(Math.max(duration - 1, 0), true);
        player.pauseVideo();
        finished = true;
      } catch {
        // Player not ready or API changed: marking still works for next time.
      }
    }
    return finished;
  }

  const api = {
    MarkWatchedError,
    parseVideoId,
    extractPlayerResponse,
    isLoggedIn,
    generateCpn,
    buildTrackingUrls,
    markWatched,
    finishPlayback,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YtSawIt = api;
})(globalThis);
