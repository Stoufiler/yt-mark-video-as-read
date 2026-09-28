const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MarkWatchedError,
  parseVideoId,
  extractPlayerResponse,
  isLoggedIn,
  generateCpn,
  buildTrackingUrls,
  markWatched,
  finishPlayback,
} = require('../src/mark-watched.js');

const ID = 'dQw4w9WgXcQ';

function playerResponse({ len = '214', lengthSeconds = '214' } = {}) {
  const qs = `cl=1&docid=${ID}&ns=yt&el=detailpage` + (len ? `&len=${len}` : '');
  return {
    videoDetails: { videoId: ID, title: 'Never "Gonna" {Give} You Up', lengthSeconds },
    playbackTracking: {
      videostatsPlaybackUrl: { baseUrl: `https://s.youtube.com/api/stats/playback?${qs}` },
      videostatsWatchtimeUrl: { baseUrl: `https://s.youtube.com/api/stats/watchtime?${qs}` },
    },
  };
}

function watchHtml(player, { loggedIn = true } = {}) {
  return `<html><script>ytcfg.set({"LOGGED_IN":${loggedIn}});</script>` +
    `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = document.createElement('meta');</script></html>`;
}

function rejectsWithCode(promise, code, status) {
  return assert.rejects(promise, (err) => {
    assert.ok(err instanceof MarkWatchedError);
    assert.equal(err.code, code);
    if (status !== undefined) assert.equal(err.status, status);
    return true;
  });
}

test('parseVideoId handles YouTube URL formats', () => {
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s`), ID);
  assert.equal(parseVideoId(`/watch?v=${ID}&list=PL123`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/shorts/${ID}`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/live/${ID}`), ID);
  assert.equal(parseVideoId(`https://youtu.be/${ID}?si=abc`), ID);
  assert.equal(parseVideoId(`https://m.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseVideoId('https://www.youtube.com/@channel'), null);
  assert.equal(parseVideoId(`https://example.com/watch?v=${ID}`), null);
  assert.equal(parseVideoId(`https://notyoutube.com/watch?v=${ID}`), null);
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=tooshort'), null);
  assert.equal(parseVideoId('not a url ::'), null);
  assert.equal(parseVideoId(undefined), null);
});

test('extractPlayerResponse parses JSON with braces and quotes inside strings', () => {
  const player = playerResponse();
  assert.deepEqual(extractPlayerResponse(watchHtml(player)), player);
});

test('extractPlayerResponse returns null when there is no player response', () => {
  assert.equal(extractPlayerResponse('<html>nothing here</html>'), null);
});

test('isLoggedIn detects the session', () => {
  assert.equal(isLoggedIn(watchHtml(playerResponse(), { loggedIn: true })), true);
  assert.equal(isLoggedIn(watchHtml(playerResponse(), { loggedIn: false })), false);
});

test('generateCpn yields 16 characters from the YouTube alphabet', () => {
  assert.match(generateCpn(), /^[A-Za-z0-9_-]{16}$/);
  assert.equal(generateCpn(() => 0), 'a'.repeat(16));
  assert.equal(generateCpn(() => 0.9999), '_'.repeat(16));
});

test('buildTrackingUrls builds "watched to the end" pings', () => {
  const [playback, watchtime] = buildTrackingUrls(playerResponse(), {
    origin: 'https://www.youtube.com',
    cpn: 'CPN0123456789abc',
  }).map((u) => new URL(u));

  for (const u of [playback, watchtime]) {
    assert.equal(u.origin, 'https://www.youtube.com');
    assert.equal(u.searchParams.get('docid'), ID);
    assert.equal(u.searchParams.get('ver'), '2');
    assert.equal(u.searchParams.get('cpn'), 'CPN0123456789abc');
    assert.equal(u.searchParams.get('cmt'), '213');
    assert.equal(u.searchParams.get('el'), 'detailpage');
  }
  assert.equal(playback.pathname, '/api/stats/playback');
  assert.equal(playback.searchParams.has('et'), false);
  assert.equal(watchtime.pathname, '/api/stats/watchtime');
  assert.equal(watchtime.searchParams.get('st'), '0');
  assert.equal(watchtime.searchParams.get('et'), '213');
});

test('buildTrackingUrls falls back to videoDetails.lengthSeconds without a len param', () => {
  const [, watchtime] = buildTrackingUrls(playerResponse({ len: null, lengthSeconds: '60' }), {
    origin: 'https://www.youtube.com',
    cpn: 'x'.repeat(16),
  });
  assert.equal(new URL(watchtime).searchParams.get('et'), '59');
});

test('buildTrackingUrls fails with a clear code without playbackTracking', () => {
  assert.throws(
    () => buildTrackingUrls({ videoDetails: {} }, { origin: 'https://www.youtube.com', cpn: 'x' }),
    (err) => err instanceof MarkWatchedError && err.code === 'no-tracking',
  );
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    if (!route) return { ok: false, status: 404, text: async () => '' };
    const [, status, body = ''] = route;
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('markWatched loads the page, then sends both pings with cookies', async () => {
  const fetch = fakeFetch([
    ['https://www.youtube.com/watch', 200, watchHtml(playerResponse())],
    ['https://www.youtube.com/api/stats/', 204],
  ]);
  const result = await markWatched(ID, { fetch });

  assert.deepEqual(result, { videoId: ID, title: 'Never "Gonna" {Give} You Up' });
  assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[0].url, `https://www.youtube.com/watch?v=${ID}`);
  assert.match(fetch.calls[1].url, /\/api\/stats\/playback\?/);
  assert.match(fetch.calls[2].url, /\/api\/stats\/watchtime\?/);
  for (const call of fetch.calls) assert.equal(call.init.credentials, 'include');
});

test('markWatched refuses when signed out, without sending any ping', async () => {
  const fetch = fakeFetch([
    ['https://www.youtube.com/watch', 200, watchHtml(playerResponse(), { loggedIn: false })],
  ]);
  await rejectsWithCode(markWatched(ID, { fetch }), 'not-logged-in');
  assert.equal(fetch.calls.length, 1);
});

test('markWatched reports unreadable video data', async () => {
  const fetch = fakeFetch([
    ['https://www.youtube.com/watch', 200, '<html>"LOGGED_IN":true</html>'],
  ]);
  await rejectsWithCode(markWatched(ID, { fetch }), 'no-player-data');
});

test('markWatched reports a rejected ping', async () => {
  const fetch = fakeFetch([
    ['https://www.youtube.com/watch', 200, watchHtml(playerResponse())],
    ['https://www.youtube.com/api/stats/', 403],
  ]);
  await rejectsWithCode(markWatched(ID, { fetch }), 'ping-rejected', 403);
});

test('markWatched reports an unreachable video page', async () => {
  const fetch = fakeFetch([['https://www.youtube.com/watch', 500]]);
  await rejectsWithCode(markWatched(ID, { fetch }), 'page-unavailable', 500);
});

function fakePlayer({ videoId = ID, duration = 214, isLive = false } = {}) {
  const calls = [];
  return {
    calls,
    getVideoData: () => ({ video_id: videoId, isLive }),
    getDuration: () => duration,
    seekTo: (seconds, allowSeekAhead) => calls.push(['seekTo', seconds, allowSeekAhead]),
    pauseVideo: () => calls.push(['pauseVideo']),
  };
}

test('finishPlayback seeks the player playing this video to the end, then pauses it', () => {
  const player = fakePlayer();
  assert.equal(finishPlayback([player], ID), true);
  assert.deepEqual(player.calls, [['seekTo', 213, true], ['pauseVideo']]);
});

test('finishPlayback leaves players showing another video untouched', () => {
  const other = fakePlayer({ videoId: 'xxxxxxxxxxx' });
  const mine = fakePlayer();
  assert.equal(finishPlayback([other, mine], ID), true);
  assert.deepEqual(other.calls, []);
  assert.equal(mine.calls.length, 2);
});

test('finishPlayback skips live streams and unknown durations', () => {
  for (const player of [fakePlayer({ isLive: true }), fakePlayer({ duration: 0 }), fakePlayer({ duration: NaN })]) {
    assert.equal(finishPlayback([player], ID), false);
    assert.deepEqual(player.calls, []);
  }
});

test('finishPlayback ignores missing or broken players', () => {
  const broken = { getVideoData: () => { throw new Error('not ready'); } };
  assert.equal(finishPlayback([null, {}, broken], ID), false);
});
