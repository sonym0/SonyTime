import fs from 'node:fs';
const html = fs.readFileSync('index.html','utf8');
const js = fs.readFileSync('src/main.js','utf8');
const banned = ['https://fonts.googleapis.com','https://fonts.gstatic.com','cdnjs.cloudflare.com','http://','https://'];
const hits = [...banned.filter(x => html.includes(x) || js.includes(x))];
if (hits.length) { console.error('Offline check failed:', hits); process.exit(1); }
console.log('Offline source check: PASS');
