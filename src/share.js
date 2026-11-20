// `--share`: open the dashboard to other PCs / phones on the office network,
// like any LAN web app: a stable per-install token,
// personal links with ?t=…, an HttpOnly cookie after the first visit, and the
// token kept out of startup logs.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SHARE_DIR = path.join(os.homedir(), '.agentviewer');
export const TOKEN_FILE = path.join(SHARE_DIR, 'share-token');
export const LINK_FILE = path.join(SHARE_DIR, 'share-link.txt');
// collaborators: a separate token whose link may also hand the orchestrator a task
export const COLLAB_TOKEN_FILE = path.join(SHARE_DIR, 'collab-token');
export const COLLAB_LINK_FILE = path.join(SHARE_DIR, 'collab-link.txt');

// short codes typed on the sign-in page (http://<PC 이름>:<port>/) instead of passing long links around
export const CODES_FILE = path.join(SHARE_DIR, 'access-codes.json');

/** Stable { view, collab } 6-digit codes; delete the file to change them. */
export async function accessCodes(file = CODES_FILE) {
  try {
    const c = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (/^\d{6}$/.test(c.view) && /^\d{6}$/.test(c.collab) && c.view !== c.collab) return { view: c.view, collab: c.collab };
  } catch {}
  const code = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const view = code();
  let collab = code();
  while (collab === view) collab = code();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify({ view, collab }, null, 2)}\n`, { mode: 0o600 });
  return { view, collab };
}

export async function writeCollabLinks(port, token, file = COLLAB_LINK_FILE) {
  const links = lanAddresses().map((ip) => `http://${ip}:${port}/?c=${token}`);
  const body = [
    '# Agentviewer 공동작업자 링크 — 보기 + 오케스트레이터에게 작업 지시, 터미널 화면 보기, 승인 응답까지 할 수 있어요.',
    '# 승인하면 Codex가 이 PC에서 실제로 명령을 실행하니 믿을 수 있는 사람에게만 전달하세요.',
    '# 링크를 무효로 하려면 collab-token 파일을 지우고 Agentviewer를 다시 실행합니다.',
    ...links,
    '',
  ].join('\n');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, body, { mode: 0o600 });
  return links;
}

/** Stable token: reused across restarts so shared links keep working. Delete the file to rotate. */
export async function shareToken(file = TOKEN_FILE) {
  try {
    const t = (await fsp.readFile(file, 'utf8')).trim();
    if (t.length >= 16) return t;
  } catch {}
  const t = crypto.randomBytes(18).toString('base64url');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${t}\n`, { mode: 0o600 });
  return t;
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

export async function writeShareLinks(port, token, file = LINK_FILE) {
  const links = lanAddresses().map((ip) => `http://${ip}:${port}/?t=${token}`);
  const body = [
    '# Agentviewer 공유 링크 — 토큰이 들어 있으니 볼 사람에게만 전달하세요.',
    '# 토큰을 바꾸려면 share-token 파일을 지우고 다시 실행합니다.',
    ...links,
    '',
  ].join('\n');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, body, { mode: 0o600 });
  return links;
}

export function firewallHint(port) {
  return `New-NetFirewallRule -DisplayName "Agentviewer-LAN" -Direction Inbound -Protocol TCP -LocalPort ${port} -Profile Domain,Private -RemoteAddress LocalSubnet -Action Allow`;
}
