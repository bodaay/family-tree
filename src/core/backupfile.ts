// The family log as a file to keep elsewhere: every entry exactly as the server
// stores it (sealed with the family key), one per line, so a newer copy differs
// from an older one only by the lines it adds. Written by scripts/backup-log.ts
// and by the root admin's phone («نسخة احتياطية»); scripts/restore-log.ts puts
// either back on a server.
import type { Envelope } from './log.ts';

export function backupText(family: string, entries: Envelope[], saved = new Date()): string {
  return `{\n "family": ${JSON.stringify(family)},\n "saved": ${JSON.stringify(saved.toISOString())},\n "entries": [\n${entries.map(e => '  ' + JSON.stringify(e)).join(',\n')}\n ]\n}\n`;
}
