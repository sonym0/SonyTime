import fs from 'node:fs';
const html = fs.readFileSync('index.html','utf8');
const js = fs.readFileSync('src/main.js','utf8');
// Supabase domain is allowed for cloud sync; everything else must be offline
const allowedDomain = 'supabase.co';
const banned = ['https://fonts.googleapis.com','https://fonts.gstatic.com','cdnjs.cloudflare.com','http://'];
const hits = [...banned.filter(x => html.includes(x) || js.includes(x))];
// ban generic https:// only if not pointing to supabase.co
const genericHttps = html.match(/https:\/\/(?!supabase\.co)/g) || [];
const jsGenericHttps = js.match(/https:\/\/(?!supabase\.co)/g) || [];
if (hits.length || genericHttps.length || jsGenericHttps.length) {
  console.error('Offline check failed:', [...new Set([...hits, ...genericHttps, ...jsGenericHttps])]);
  process.exit(1);
}
console.log('Offline source check: PASS (Supabase cloud sync allowed)');
