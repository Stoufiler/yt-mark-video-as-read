const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, '_locales');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const locales = Object.fromEntries(
  fs.readdirSync(LOCALES_DIR).map((locale) => [
    locale,
    JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'messages.json'), 'utf8')),
  ]),
);

// Placeholder names used in a message, e.g. "$TITLE$" -> "title".
function placeholdersIn(message) {
  return [...message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => m[1].toLowerCase()).sort();
}

test('the default locale exists', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(locales[manifest.default_locale], `missing _locales/${manifest.default_locale}`);
});

test('every locale has exactly the same keys and placeholders as English', () => {
  const reference = locales.en;
  for (const [locale, messages] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(reference).sort(), locale);
    for (const [key, { message, placeholders = {} }] of Object.entries(messages)) {
      assert.deepEqual(placeholdersIn(message), placeholdersIn(reference[key].message), `${locale}.${key}`);
      assert.deepEqual(placeholdersIn(message), Object.keys(placeholders).sort(), `${locale}.${key}`);
    }
  }
});

test('every message used by the code or the manifest is defined', () => {
  const sources = [read('manifest.json'), ...['content.js', 'background.js'].map((f) => read('src', f))];
  const used = new Set();
  for (const source of sources) {
    for (const m of source.matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
    for (const m of source.matchAll(/(?:getMessage|\bt)\(\s*'(\w+)'/g)) used.add(m[1]);
    for (const m of source.matchAll(/'(error[A-Z]\w*|button[A-Z]\w*)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 0);
  for (const key of used) assert.ok(locales.en[key], `message "${key}" is not defined`);
});
