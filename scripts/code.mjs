// Erzeugt einen neuen Zugangscode (und beim ersten Mal alle Server-Schlüssel).
// Aufruf: npm run code            → nur neuer Zugangscode
//         npm run code -- --all   → zusätzlich SESSION_SECRET, VAPID-Schlüssel, COACH_TOKEN, STRAVA_VERIFY_TOKEN
import { webcrypto as crypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const worker = join(root, 'worker');
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/l/I
const rand = (n, alpha = ALPHA) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alpha[b % alpha.length]).join('');
const hex = (buf) => Buffer.from(buf).toString('hex');
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function put(name, value) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { cwd: worker, input: value, encoding: 'utf8', shell: true });
  if (r.status !== 0) { console.error(`Fehler bei ${name}:`, r.stderr || r.stdout); process.exit(1); }
  console.log(`✓ ${name} gespeichert`);
}

const all = process.argv.includes('--all');
const code = rand(10);
const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + code)));
put('ACCESS_CODE_HASH', `${salt}:${hash}`);

if (all) {
  put('SESSION_SECRET', b64url(crypto.getRandomValues(new Uint8Array(32))));
  put('COACH_TOKEN', b64url(crypto.getRandomValues(new Uint8Array(32))));
  put('STRAVA_VERIFY_TOKEN', b64url(crypto.getRandomValues(new Uint8Array(16))));
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64url(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  put('VAPID_PRIVATE_KEY', jwk.d);
  put('VAPID_PUBLIC_KEY', pub);
  put('VAPID_SUBJECT', 'mailto:laufcoach@example.com');
  // Öffentlicher Schlüssel ist kein Geheimnis – kommt ins Frontend
  writeFileSync(join(root, 'src', 'vapid-public.js'), `export const VAPID_PUBLIC_KEY = '${pub}';\n`);
  console.log('✓ VAPID-Public-Key nach src/vapid-public.js geschrieben');
}

console.log('\n==============================================');
console.log(`  DEIN ZUGANGSCODE:  ${code}`);
console.log('==============================================');
console.log('Jetzt in deiner Passwort-App speichern. Er wird nirgends sonst gespeichert.\n');
