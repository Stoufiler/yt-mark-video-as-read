/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * UI on youtube.com: a button on hovered thumbnails, a button on the watch
 * page, and handling of context-menu requests from the background script.
 */
(() => {
  'use strict';

  const { markWatched, finishPlayback, parseVideoId } = globalThis.YtSawIt;
  const { addWatchedId } = globalThis.YtSawItIds;
  const t = (key, substitutions) => browser.i18n.getMessage(key, substitutions);

  // `content.fetch` (Firefox) issues the request on behalf of the page: same
  // cookies and same origin as youtube.com.
  const pageFetch = typeof content !== 'undefined' && content.fetch
    ? content.fetch.bind(content)
    : fetch.bind(globalThis);

  const LINK_SELECTOR = 'a[href*="/watch?v="], a[href*="/shorts/"]';
  const THUMB_CONTENT_SELECTOR = 'img, yt-image, yt-thumbnail-view-model, ytd-thumbnail';
  const WATCH_ACTIONS_SELECTOR =
    'ytd-watch-metadata #top-level-buttons-computed, ytd-watch-metadata #actions-inner';

  const ERROR_MESSAGES = {
    'page-unavailable': 'errorPageUnavailable',
    'not-logged-in': 'errorNotLoggedIn',
    'no-player-data': 'errorNoPlayerData',
    'no-tracking': 'errorNoTracking',
    'ping-rejected': 'errorPingRejected',
  };

  const STORAGE_KEY = 'watchedIds';
  const watched = new Set();
  const pending = new Set();

  // --- Persistence ------------------------------------------------------------

  // Remembered locally so buttons still show "Watched" after a reload, and in
  // every open YouTube tab.
  browser.storage.local.get(STORAGE_KEY).then((data) => {
    for (const id of data[STORAGE_KEY] || []) watched.add(id);
    refresh();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    watched.clear();
    for (const id of changes[STORAGE_KEY].newValue || []) watched.add(id);
    refresh();
  });

  async function remember(videoId) {
    try {
      const data = await browser.storage.local.get(STORAGE_KEY);
      await browser.storage.local.set({ [STORAGE_KEY]: addWatchedId(data[STORAGE_KEY], videoId) });
    } catch (err) {
      // The video is marked on YouTube anyway; only the local reminder is lost.
      console.warn('[Mark as Watched] Could not save to local storage:', err);
    }
  }

  // --- Marking --------------------------------------------------------------

  function describeError(err) {
    const key = err && ERROR_MESSAGES[err.code];
    if (key) return t(key, err.status === undefined ? undefined : [String(err.status)]);
    return t('errorUnknown', [String((err && err.message) || err)]);
  }

  async function mark(videoId) {
    if (!videoId) {
      toast(t('errorInvalidLink'), true);
      return;
    }
    if (watched.has(videoId) || pending.has(videoId)) return;

    pending.add(videoId);
    refresh();
    try {
      const { title } = await markWatched(videoId, { fetch: pageFetch, origin: location.origin });
      watched.add(videoId);
      finishPlayback(pagePlayers(), videoId);
      toast(t('toastMarked', [title || videoId]));
      await remember(videoId);
    } catch (err) {
      toast(describeError(err), true);
    } finally {
      pending.delete(videoId);
      refresh();
    }
  }

  // YouTube's player API lives in the page: `wrappedJSObject` (Firefox) exposes it.
  function pagePlayers() {
    return [...document.querySelectorAll('#movie_player, #shorts-player')]
      .map((element) => element.wrappedJSObject);
  }

  // --- Toast ----------------------------------------------------------------

  let toastEl;
  let toastTimer;

  function toast(message, isError = false) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ytsi-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.toggle('ytsi-toast--error', isError);
    toastEl.classList.add('ytsi-toast--visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('ytsi-toast--visible'), 4000);
  }

  // --- Buttons --------------------------------------------------------------

  function stateOf(videoId) {
    if (videoId && watched.has(videoId)) return 'done';
    if (videoId && pending.has(videoId)) return 'pending';
    return 'idle';
  }

  const LABELS = { idle: 'buttonMark', pending: 'buttonMarking', done: 'buttonWatched' };

  function renderButton(button, videoId) {
    const state = stateOf(videoId);
    // Without this guard, our own writes would retrigger the observer forever.
    if (button.dataset.state === state) return;
    button.dataset.state = state;
    button.textContent = t(LABELS[state]);
    button.title = t(state === 'done' ? 'buttonTitleWatched' : 'buttonTitleMark');
    // Not `disabled`: a disabled button swallows the click, which could then
    // reach the surrounding link. mark() already ignores repeated clicks.
    button.setAttribute('aria-busy', String(state === 'pending'));
  }

  function createButton(variant) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ytsi-btn ytsi-btn--${variant}`;
    return button;
  }

  function decorateThumbnails() {
    for (const link of document.querySelectorAll(LINK_SELECTOR)) {
      let button = link.querySelector(':scope > .ytsi-btn--thumb');
      if (!button) {
        if (!link.querySelector(THUMB_CONTENT_SELECTOR)) continue;
        if (link.parentElement && link.parentElement.closest('.ytsi-host')) continue;
        link.classList.add('ytsi-host');
        button = link.appendChild(createButton('thumb'));
      }
      // YouTube recycles elements across videos: always re-read the link.
      const videoId = parseVideoId(link.href);
      renderButton(button, videoId);
      link.classList.toggle('ytsi-watched', stateOf(videoId) === 'done');
    }
  }

  function decorateWatchPage() {
    const videoId = location.pathname === '/watch' ? parseVideoId(location.href) : null;
    let button = document.querySelector('.ytsi-btn--watch');
    if (!videoId) {
      if (button) button.remove();
      return;
    }
    if (!button) {
      const container = document.querySelector(WATCH_ACTIONS_SELECTOR);
      if (!container) return;
      button = container.appendChild(createButton('watch'));
    }
    renderButton(button, videoId);
  }

  // --- Events ---------------------------------------------------------------

  function ownButton(target) {
    return target && target.closest ? target.closest('.ytsi-btn') : null;
  }

  // Our thumbnail buttons live inside YouTube's links. Capturing at the window
  // level runs before any YouTube handler, so a click never opens the video.
  window.addEventListener('click', (event) => {
    const button = ownButton(event.target);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const link = button.closest('a');
    mark(parseVideoId(button.classList.contains('ytsi-btn--watch') || !link ? location.href : link.href));
  }, true);

  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick']) {
    window.addEventListener(type, (event) => {
      if (ownButton(event.target)) event.stopImmediatePropagation();
    }, true);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'yt-saw-it:mark') mark(parseVideoId(message.url));
  });

  // --- Lifecycle ------------------------------------------------------------

  let scheduled = false;
  function refresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorateThumbnails();
      decorateWatchPage();
    });
  }

  new MutationObserver(refresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });
  document.addEventListener('yt-navigate-finish', refresh);

  refresh();
})();
