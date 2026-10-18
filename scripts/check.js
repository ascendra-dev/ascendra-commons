#!/usr/bin/env node
/**
 * Repo rules a consumer's `ascendra-commons.js` depends on, which nothing else enforces (MODULE-STANDARD §1b,
 * dimensions 2, 7 and 11). Run by the pre-push hook (.githooks/pre-push) and `npm run check`; exits 1 on a violation.
 *
 * 1. Package boundaries — a package imports another only through its root (`index.ts`); code (tests are exempt from
 *    the direction rules) imports another pattern's `.core` package only, and within a pattern only its own
 *    ancestors (`a.core.x.postgres-drizzle` → `a.core.x`, `a.core`) — except `.api`, which may also use a family
 *    (`a.core.<family>`, a package with packages under it), never a stack adapter.
 * 2. Migration layout — SQL lives only in `<package>/migrations/`, named `NNNN_<snake_case>.sql`, numbered 0001… with
 *    no gaps.
 * 3. Released migrations — nothing on `origin/main` under a `migrations/` folder is modified, renamed or deleted (the
 *    working tree included). Consumers' databases have already run those files.
 * 4. Breaking changes — every unpushed commit marked `!` carries a `BREAKING CHANGE:` footer, the instructions
 *    `ascendra-commons.js update` shows a consumer.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isPackage, importsOf, listFiles } = require('../ascendra-commons.js');

const ROOT = path.resolve(__dirname, '..');
const RELEASED = 'origin/main';
const failures = [];
const fail = (rule, message) => failures.push(`[${rule}] ${message}`);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function packages() {
  const out = [];
  for (const p of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!p.isDirectory() || p.name.startsWith('.') || ['node_modules', 'scripts'].includes(p.name)) continue;
    if (isPackage(ROOT, p.name)) out.push(p.name);
    else for (const k of fs.readdirSync(path.join(ROOT, p.name), { withFileTypes: true })) if (k.isDirectory()) out.push(`${p.name}/${k.name}`);
  }
  return out;
}

// ─── 1. package boundaries ─────────────────────────────────────────────────────

function checkBoundaries(all) {
  const name = (id) => id.split('/').pop();
  const pattern = (id) => id.split('/')[0];
  const isFamily = (id) => all.some((other) => pattern(other) === pattern(id) && name(other).startsWith(`${name(id)}.`));
  for (const id of all) {
    for (const imp of importsOf(ROOT, id)) {
      if (!imp.target) continue;
      const where = `${imp.file} imports '${imp.specifier}'`;
      if (!imp.entry) fail('boundary', `${where} — import ${imp.target} through its index.ts, not a file inside it`);
      if (imp.isSpec) continue;
      const to = imp.target;
      if (pattern(to) !== pattern(id)) {
        const flat = !to.includes('/');
        if (!flat && name(to) !== `${pattern(to)}.core`) fail('direction', `${where} — another module is used through its .core package only (MODULE-STANDARD §1b)`);
        continue;
      }
      const ancestor = name(id).startsWith(`${name(to)}.`);
      const apiUse = name(id) === `${pattern(id)}.api` && (name(to) === `${pattern(id)}.core` || isFamily(to));
      if (!ancestor && !apiUse) fail('direction', `${where} — ${name(id)} may depend on its own ancestors${name(id).endsWith('.api') ? ' or a family' : ''} only (MODULE-STANDARD §1b)`);
    }
  }
}

// ─── 2. migration layout ───────────────────────────────────────────────────────

function checkMigrationLayout(all) {
  for (const id of all) {
    for (const rel of listFiles(path.join(ROOT, id)).filter((f) => f.endsWith('.sql'))) {
      if (path.posix.dirname(rel) !== 'migrations') fail('migrations', `${id}/${rel} — SQL belongs in ${id}/migrations/`);
    }
    const dir = path.join(ROOT, id, 'migrations');
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f !== '.DS_Store').sort();
    files.forEach((f, i) => {
      if (!/^\d{4}_[a-z0-9]+(_[a-z0-9]+)*\.sql$/.test(f)) fail('migrations', `${id}/migrations/${f} — name it NNNN_<snake_case>.sql`);
      else if (Number(f.slice(0, 4)) !== i + 1) fail('migrations', `${id}/migrations/${f} — expected number ${String(i + 1).padStart(4, '0')} (no gaps, no duplicates)`);
    });
  }
}

// ─── 3. released migrations ────────────────────────────────────────────────────

function hasReleasedRef() {
  try { git('rev-parse', '--verify', '--quiet', RELEASED); return true; } catch { return false; }
}

function checkReleasedMigrations() {
  // Working tree against what consumers can sync — committed and uncommitted changes alike.
  const lines = git('diff', '--name-status', '-M', RELEASED, '--', ':(glob)**/migrations/*.sql').split('\n').filter(Boolean);
  for (const line of lines) {
    const [status, ...paths] = line.split('\t');
    if (status === 'A') continue;
    const verb = { M: 'modified', D: 'deleted' }[status[0]] ?? (status.startsWith('R') ? 'renamed' : status);
    fail('released', `${paths.join(' → ')} — ${verb}, but it is on ${RELEASED}; a schema change is the next numbered file`);
  }
}

// ─── 4. breaking-change footers ────────────────────────────────────────────────

function checkBreakingFooters() {
  const log = git('log', '--format=%h%x1f%s%x1f%b%x1e', `${RELEASED}..HEAD`);
  for (const record of log.split('\x1e').map((r) => r.trim()).filter(Boolean)) {
    const [hash, subject, body = ''] = record.split('\x1f');
    if (/^\w+(\([^)]*\))?!:/.test(subject) && !/^BREAKING CHANGE:\s*\S/m.test(body)) {
      fail('breaking', `${hash} "${subject}" — marked ! but has no "BREAKING CHANGE: <what the consumer must do>" footer`);
    }
  }
}

// ─── main ──────────────────────────────────────────────────────────────────────

const all = packages();
checkBoundaries(all);
checkMigrationLayout(all);
if (hasReleasedRef()) {
  checkReleasedMigrations();
  checkBreakingFooters();
} else {
  console.log(`(No ${RELEASED} ref — skipping the released-migration and breaking-footer checks. git fetch first.)`);
}

if (failures.length) {
  console.error(`✗ ${failures.length} problem(s):\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log(`✓ ${all.length} packages: boundaries, migration layout, released migrations, breaking footers.`);
}
