import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([".git", ".next", "node_modules", "dist", "demo-dist", "coverage", "playwright-report", "test-results"]);
const patterns = {
  "private-key": /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  "api-token": /(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{20,}/,
  "private-home": /\/home\/[A-Za-z0-9._-]+\//,
  "private-domain": /713007\.xyz/i,
  "personal-email": /\b\d{5,}@(qq|foxmail)\.com\b/i,
  "authorization-header": /authorization\s*[:=]\s*["'](?:bearer\s+)?[A-Za-z0-9._-]{20,}["']/i,
  "remote-database-credential": /postgres(?:ql)?:\/\/(?!\$\{)[^:\s]+:(?!\$\{)[^@\s]+@(?!localhost|127\.0\.0\.1)/i,
};

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

const findings = [];
let checked = 0;
for (const file of await walk(root)) {
  let text;
  try { text = await readFile(file, "utf8"); } catch { continue; }
  checked += 1;
  for (const [name, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) findings.push(`${path.relative(root, file)}: ${name}`);
  }
}

if (findings.length) {
  console.error(`Public safety scan failed:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`Public safety scan passed (${checked} text files checked).`);