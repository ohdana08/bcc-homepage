// Local operator helper: validates a chat-prepared event, never reads credentials,
// never executes SQL or contacts a model. Keep the input/output outside this repo.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeEvent, uuid } from '../lib/lecture-desk-domain.js';

export function eventSQL(input, actorId = null) {
  const event = normalizeEvent(input);
  const payload = JSON.stringify(event).replaceAll("'", "''");
  // Fail closed with NULL when multiple/no admins exist. Never choose arbitrary first user.
  const actor = actorId ? `'${uuid(actorId)}'::uuid` : `(select case when count(*) = 1 then (array_agg(id))[1] else null end from public.profiles where is_admin is true)`;
  return `select public.bcc_lecture_desk_apply('${payload}'::jsonb, ${actor}) as result;\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, actor] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node scripts/lecture-desk-event-sql.mjs PRIVATE_EVENT.json PRIVATE_QUERY.sql [ADMIN_UUID]');
  const value = JSON.parse(await readFile(input, 'utf8'));
  await writeFile(output, eventSQL(value, actor), { mode: 0o600, flag: 'wx' });
  process.stdout.write('Validated SQL saved. Execute against bcc-business only, then read back case_id/revision.\n');
}
