import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// Restore the three source files exactly as they were in the verified six-weapon prototype.
// This step is idempotent and runs automatically before npm start.
const root = path.dirname(fileURLToPath(import.meta.url));
const parts = Array.from({ length: 7 }, (_, i) =>
  fs.readFileSync(path.join(root, 'source-parts', `part${String(i + 1).padStart(2, '0')}.txt`), 'utf8').trim()
);
const compressed = Buffer.from(parts.join(''), 'base64');
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== '56000c2a939de9a4e7e32a501f888698bf506b7c5853dac1f6e91c9d8d488dce')
  throw new Error('Game source integrity check failed');
const files = JSON.parse(brotliDecompressSync(compressed).toString('utf8'));
const allowed = new Set(['server.js', 'public/game.js', 'public/style.css']);
if (Object.keys(files).length !== allowed.size) throw new Error('Unexpected source file count');
for (const [relative, contents] of Object.entries(files)) {
  if (!allowed.has(relative) || typeof contents !== 'string')
    throw new Error('Unexpected source path: ' + relative);
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, contents, 'utf8');
}
console.log('Restored server.js, public/game.js and public/style.css');

const testCompressed = Buffer.from(
  fs.readFileSync(path.join(root, 'source-parts', 'tests.br64'), 'utf8').trim(), 'base64'
);
const testDigest = crypto.createHash('sha256').update(testCompressed).digest('hex');
if (testDigest !== 'f662f4ffa29f1f6c47951340e19d29a1a778ab21df3b8d71ae3cc00aab22f66d')
  throw new Error('Battle tests integrity check failed');
fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
fs.writeFileSync(path.join(root, 'tests', 'engine.test.js'), brotliDecompressSync(testCompressed));
console.log('Restored the nine multiplayer battle tests');
