# Mark as Watched for YouTube

A Firefox add-on that marks a YouTube video as **watched** on your account, without
using "Not interested". The algorithm keeps recommending that kind of content, but
knows you've already seen this video: it goes into your watch history and its
thumbnail shows YouTube's red "watched" bar.

Useful when you've watched a video on another account (a shared one, a friend's TV…)
and YouTube keeps suggesting it to you.

Available in English and French.

## Usage

- **Hover a thumbnail** (home, recommendations, search, subscriptions): a `✓ Mark as watched` button appears in the top-left corner.
- **Right-click a video link** → "Mark as watched".
- **On a video page**: `✓ Mark as watched` button next to Like / Share.

A notification in the bottom-left corner confirms it (or explains why it failed).
Check the result at https://www.youtube.com/feed/history.

If the video is the one currently playing, it also jumps to the end and pauses:
otherwise the player would keep reporting its real position and undo the marking.

> If the hover video preview covers the button, use right-click instead, or turn off
> "Inline playback" in YouTube's playback settings.

## How it works

The same technique as `yt-dlp --mark-watched`: the add-on loads the video page with
your cookies, reads the player's tracking URLs (`videostatsPlaybackUrl`,
`videostatsWatchtimeUrl`) and calls them as if the video had been played to the end.
Nothing is played, no tab is opened, and no request goes anywhere but youtube.com.
No data is collected: the list of videos you marked is only stored in your browser.

These endpoints are internal to YouTube: stable for years, but not guaranteed.

## Development

Requires Node.js ≥ 20.

```sh
npm test              # unit tests
npx web-ext lint      # Mozilla's add-on linter
npx web-ext run       # launches Firefox with the add-on loaded
npx web-ext build     # builds the .zip into web-ext-artifacts/
```

To try it in your own Firefox without web-ext: `about:debugging#/runtime/this-firefox`
→ "Load Temporary Add-on…" → pick `manifest.json`.

| File                  | Role                                                   |
| --------------------- | ------------------------------------------------------ |
| `src/mark-watched.js` | Marking logic (pure, unit-tested)                      |
| `src/content.js`      | Buttons, notifications, tracking YouTube page changes  |
| `src/background.js`   | Context menu                                           |
| `src/content.css`     | Styles                                                 |
| `_locales/*/`         | Translations (`en` is the default)                     |
| `amo-metadata.json`   | addons.mozilla.org listing (summary, description…)     |

### Adding a language

Copy `_locales/en/messages.json` to `_locales/<code>/messages.json` and translate
the `message` fields. `npm test` checks that every locale has the same keys and
placeholders.

## Publishing on addons.mozilla.org

1. Create API credentials at https://addons.mozilla.org/developers/addon/api/key/.
2. Bump `version` in `manifest.json` for every new release.
3. Run:

   ```sh
   WEB_EXT_API_KEY=… WEB_EXT_API_SECRET=… npx web-ext sign
   ```

   `web-ext-config.mjs` submits to the public (listed) channel with the listing from
   `amo-metadata.json`. The add-on then goes through Mozilla's review.

## License

[MPL-2.0](LICENSE)

This add-on is not affiliated with or endorsed by YouTube or Google.
