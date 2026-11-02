// Development-only command relay of the local test environment (priitkustala/ai-news#40):
// the ai-news-frontend box's scenarios set up their Given with this checkout's `seed`,
// `ingest` and `sign-in` commands (E2E_BACKEND_COMMAND). POST /run with {"args": [...]}
// runs `node dist/cli.js <args>` and answers {"exitCode", "stdout", "stderr"}; any other
// subcommand is refused. It listens only on the compose networks (no host port), runs one
// command at a time (the scenarios run on one worker, AD-08) and logs the subcommand only.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const PORT = Number(process.env.COMMANDS_PORT ?? 8090);
const ALLOWED = new Set(['seed', 'ingest', 'sign-in']);
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BODY = 64 * 1024;
let busy = false;

function answer(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: process.env, timeout: TIMEOUT_MS });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ exitCode: null, stdout, stderr: `${stderr}${error.message}\n` }));
    child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') return answer(response, 200, { ok: true });
  if (request.method !== 'POST' || request.url !== '/run') return answer(response, 404, { error: 'POST /run only' });
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) request.destroy();
  });
  request.on('end', async () => {
    let args;
    try {
      args = JSON.parse(body).args;
    } catch {
      return answer(response, 400, { error: 'the body must be JSON: {"args": [...]}' });
    }
    if (!Array.isArray(args) || args.length === 0 || !args.every((arg) => typeof arg === 'string')) {
      return answer(response, 400, { error: 'args must be a non-empty list of strings' });
    }
    if (!ALLOWED.has(args[0])) return answer(response, 403, { error: `only ${[...ALLOWED].join(', ')} are relayed` });
    if (busy) return answer(response, 409, { error: 'another command is running' });
    busy = true;
    process.stdout.write(`[${new Date().toISOString()}] relay ${args[0]}\n`);
    try {
      answer(response, 200, await run(args));
    } finally {
      busy = false;
    }
  });
});

server.listen(PORT, () => process.stdout.write(`command relay on port ${PORT}\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
