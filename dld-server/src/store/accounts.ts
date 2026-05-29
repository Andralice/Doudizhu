import fs from 'fs';
import path from 'path';

export interface Account {
  accountId: string;
  nickname: string;
  createdAt: string;
  lastLogin: string;
  gamesPlayed: number;
  gamesWon: number;
}

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

let accounts: Map<string, Account> = new Map();
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      for (const acc of data) {
        accounts.set(acc.accountId, acc);
      }
    }
  } catch (err) {
    console.error('[Accounts] Load error:', err);
  }
  loaded = true;
}

function save() {
  try {
    const data = Array.from(accounts.values());
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Accounts] Save error:', err);
  }
}

export function register(accountId: string, nickname: string): { success: boolean; error?: string; account?: Account } {
  ensureLoaded();
  if (accounts.has(accountId)) {
    return { success: false, error: '该账号已注册，请直接登录' };
  }
  const acc: Account = {
    accountId,
    nickname,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    gamesPlayed: 0,
    gamesWon: 0,
  };
  accounts.set(accountId, acc);
  save();
  return { success: true, account: acc };
}

export function login(accountId: string): { success: boolean; error?: string; account?: Account } {
  ensureLoaded();
  const acc = accounts.get(accountId);
  if (!acc) {
    return { success: false, error: '账号不存在，请先注册' };
  }
  acc.lastLogin = new Date().toISOString();
  save();
  return { success: true, account: acc };
}

export function recordGame(accountId: string, won: boolean) {
  ensureLoaded();
  const acc = accounts.get(accountId);
  if (!acc) return;
  acc.gamesPlayed++;
  if (won) acc.gamesWon++;
  save();
}

export function getAccount(accountId: string): Account | null {
  ensureLoaded();
  return accounts.get(accountId) ?? null;
}

export function getStats(accountId: string): { gamesPlayed: number; gamesWon: number; winRate: string } | null {
  const acc = accounts.get(accountId);
  if (!acc) return null;
  const rate = acc.gamesPlayed > 0 ? ((acc.gamesWon / acc.gamesPlayed) * 100).toFixed(1) + '%' : '0%';
  return { gamesPlayed: acc.gamesPlayed, gamesWon: acc.gamesWon, winRate: rate };
}
