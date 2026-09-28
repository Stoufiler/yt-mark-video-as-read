/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

'use strict';

const MENU_ID = 'yt-saw-it-mark';

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: MENU_ID,
    title: browser.i18n.getMessage('menuMarkWatched'),
    contexts: ['link'],
    documentUrlPatterns: ['*://www.youtube.com/*'],
    targetUrlPatterns: ['*://www.youtube.com/watch*', '*://www.youtube.com/shorts/*'],
  });
});

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id === undefined) return;
  browser.tabs.sendMessage(tab.id, { type: 'yt-saw-it:mark', url: info.linkUrl }).catch(() => {
    // The content script isn't there yet (tab opened before install): nothing to do.
  });
});
