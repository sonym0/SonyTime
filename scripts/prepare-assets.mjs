import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fontRoot = path.join(root, 'node_modules', '@fontsource', 'cairo');
const out = path.join(root, 'public', 'assets', 'fonts');
fs.mkdirSync(out, { recursive: true });

function pick(weight) {
  const candidates = [
    `cairo-arabic-${weight}-normal.woff2`,
    `cairo-${weight}-normal.woff2`,
    `${weight}-normal.woff2`
  ];
  for (const c of candidates) {
    const p = path.join(fontRoot, c);
    if (fs.existsSync(p)) return p;
  }
  const all = fs.readdirSync(fontRoot).filter(x => x.endsWith('.woff2') && x.includes(String(weight)));
  if (all.length) return path.join(fontRoot, all[0]);
  throw new Error(`Cairo ${weight} woff2 not found in @fontsource/cairo`);
}
for (const w of [400,600,800]) fs.copyFileSync(pick(w), path.join(out, `cairo-${w}.woff2`));
console.log('Local Cairo fonts copied to public/assets/fonts');
