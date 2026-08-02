import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const envFile = process.argv[2] ?? '.env';
const absoluteEnvFile = resolve(envFile);

let content;
try {
  content = readFileSync(absoluteEnvFile, 'utf8');
} catch {
  console.error(`Missing ${envFile}. Copy an example file and set the endpoint first.`);
  process.exit(1);
}

const values = Object.fromEntries(
  content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const httpUrl = values.SITSYNC_HTTP_URL ?? '';
const wsUrl = values.SITSYNC_WS_URL ?? '';
const allowInsecure = values.SITSYNC_ALLOW_INSECURE_HTTP === 'true';
const isTls = httpUrl.startsWith('https://') && wsUrl.startsWith('wss://');
const isCleartextDemo = httpUrl.startsWith('http://') && wsUrl.startsWith('ws://');

if (
  !httpUrl ||
  !wsUrl ||
  httpUrl.includes('EC2_PUBLIC_IP') ||
  httpUrl.includes('example.com') ||
  wsUrl.includes('EC2_PUBLIC_IP') ||
  wsUrl.includes('example.com')
) {
  console.error(`Set real SITSYNC_HTTP_URL and SITSYNC_WS_URL values in ${envFile}.`);
  process.exit(1);
}

if (!isTls && !(allowInsecure && isCleartextDemo)) {
  console.error(
    'Use HTTPS/WSS, or set matching HTTP/WS endpoints with SITSYNC_ALLOW_INSECURE_HTTP=true.',
  );
  process.exit(1);
}

const result = spawnSync('./gradlew', ['assembleRelease'], {
  cwd: resolve('android'),
  env: {
    ...process.env,
    ENVFILE: envFile,
    GRADLE_USER_HOME:
      process.env.SITSYNC_GRADLE_USER_HOME ??
      resolve('android/.gradle-release'),
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
