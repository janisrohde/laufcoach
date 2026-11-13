// Erzeugt einen neuen Coach-Schlüssel für die Claude-Routine, speichert ihn im Worker
// und kopiert ihn in die Zwischenablage. Er wird NICHT angezeigt.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const worker = join(dirname(fileURLToPath(import.meta.url)), '..', 'worker');
const token = randomBytes(32).toString('base64url');
const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'COACH_TOKEN'], { cwd: worker, input: token, encoding: 'utf8', shell: true });
if (r.status !== 0) { console.error('Fehler beim Speichern im Worker.'); process.exit(1); }
spawnSync('clip', { input: token, shell: true });
console.log('\n✓ Neuer Coach-Schlüssel ist im Worker gespeichert und in deiner Zwischenablage.');
console.log('  Jetzt auf claude.ai bei der Umgebung als Variable LAUFCOACH_TOKEN einfügen (Strg+V).\n');
