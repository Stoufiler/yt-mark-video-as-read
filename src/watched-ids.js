/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * The list of videos marked as watched, persisted in browser.storage.local
 * as an array of ids, oldest first.
 */
(function (root) {
  'use strict';

  const MAX_WATCHED_IDS = 10000;

  function addWatchedId(ids, id, max = MAX_WATCHED_IDS) {
    const list = Array.isArray(ids) ? ids.filter((existing) => existing !== id) : [];
    list.push(id);
    return list.slice(-max);
  }

  const api = { addWatchedId };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YtSawItIds = api;
})(globalThis);
