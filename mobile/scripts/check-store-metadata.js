#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'store.config.json'), 'utf8'));
const limits = { title: 30, subtitle: 30, promoText: 170, description: 4000, releaseNotes: 4000 };
const errors = [];
for (const [locale, info] of Object.entries(config.apple?.info ?? {})) {
  for (const [field, limit] of Object.entries(limits)) if (typeof info[field] === 'string' && [...info[field]].length > limit) errors.push(`${locale}.${field}: ${[...info[field]].length}/${limit}`);
  const keywords = Array.isArray(info.keywords) ? info.keywords.join(',') : '';
  if (Buffer.byteLength(keywords, 'utf8') > 100) errors.push(`${locale}.keywords: ${Buffer.byteLength(keywords, 'utf8')}/100 bytes`);
  for (const screenshot of Object.values(info.screenshots ?? {}).flat()) if (!fs.existsSync(path.resolve(__dirname, '..', screenshot))) errors.push(`${locale}.screenshots: missing ${screenshot}`);
}
if (errors.length) { console.error('Store metadata validation failed:\n' + errors.map((e) => `- ${e}`).join('\n')); process.exit(1); }
console.log('Store metadata is valid.');
