// Configuration for Mozilla's web-ext tool (lint, run, build, sign).
export default {
  ignoreFiles: [
    'amo-metadata.json',
    'package.json',
    'package-lock.json',
    'README.md',
    'store',
    'test',
    'web-ext-config.mjs',
  ],
  sign: {
    channel: 'listed',
    amoMetadata: 'amo-metadata.json',
  },
};
