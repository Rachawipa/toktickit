import crypto from "crypto";

const ITERATIONS = 10000;
const KEY_LEN = 64;
const DIGEST = "sha512";

/**
 * Hash a password using PBKDF2 sync.
 * Returns a string formatted as "salt:hash"
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored "salt:hash" string.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const testHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString("hex");
  return hash === testHash;
}

// Session Management (stored in PostgreSQL so sessions survive restarts,
// redeploys and multiple Cloud Run instances; only a SHA-256 of the token is stored)
import { getPrisma } from "./prisma.js";

export interface Session {
  userId: number;
  email: string;
  name: string;
  role: string;
  expiresAt: Date;
}

const SESSION_HOURS = 24;

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

export async function createSession(
  userId: number,
  email: string,
  name: string,
  role: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await getPrisma().session.create({
    data: { tokenHash: hashToken(token), userId, email, name, role, expiresAt },
  });
  return token;
}

export async function getSession(token: string): Promise<Session | null> {
  const tokenHash = hashToken(token);
  const session = await getPrisma().session.findUnique({ where: { tokenHash } });
  if (!session) return null;
  if (new Date() > session.expiresAt) {
    await getPrisma().session.deleteMany({ where: { tokenHash } });
    return null;
  }
  return session;
}

export async function destroySession(token: string): Promise<boolean> {
  const { count } = await getPrisma().session.deleteMany({
    where: { tokenHash: hashToken(token) },
  });
  return count > 0;
}
