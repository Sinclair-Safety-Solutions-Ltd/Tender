import { execSync } from 'node:child_process';

// braces <= 3.0.3 has no patched release. Tailwind 3 and ESLint reach it only
// through their glob stack, and the non-breaking fix does not exist yet.
// Drop this entry when a braces release falls outside that range.
const ALLOWED_ADVISORIES = new Set([
  'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
]);

let raw = '';
try {
  raw = execSync('npm audit --json', {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
} catch (error) {
  raw = error.stdout ?? '';
  if (!raw) throw error;
}

const report = JSON.parse(raw);
const vulnerabilities = report.vulnerabilities ?? {};

function advisoryUrls(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return [];
  if (vulnerability.severity !== 'high' && vulnerability.severity !== 'critical') return [];
  const urls = [];
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'string') {
      urls.push(...advisoryUrls(via, seen));
      continue;
    }
    if (via.severity === 'high' || via.severity === 'critical') {
      urls.push(via.url ?? '');
    }
  }
  return urls;
}

const blockers = [];
for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (vulnerability.severity !== 'high' && vulnerability.severity !== 'critical') continue;
  const urls = [...new Set(advisoryUrls(name))];
  const allowed = urls.length > 0 && urls.every((url) => ALLOWED_ADVISORIES.has(url));
  if (!allowed) blockers.push({ name, urls });
}

if (blockers.length > 0) {
  console.error('High-severity advisories still need a fix:');
  for (const blocker of blockers) {
    console.error(`- ${blocker.name}: ${blocker.urls.filter(Boolean).join(', ') || 'no advisory url'}`);
  }
  process.exit(1);
}

console.log('No unaccepted high-severity advisories.');
