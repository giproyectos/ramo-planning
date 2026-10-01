import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const b64url = (buf: Buffer) => buf.toString('base64url');

/** scrypt con sal aleatoria; el formato guarda los parámetros para poder subir el costo más adelante. */
export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(`scrypt$16384$8$1$${b64url(salt)}$${b64url(key)}`)));
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return Promise.resolve(false);
  return new Promise((resolve) => {
    scrypt(password, Buffer.from(salt, 'base64url'), 32, { N: Number(n), r: Number(r), p: Number(p) }, (err, key) => {
      const expected = Buffer.from(hash, 'base64url');
      resolve(!err && key.length === expected.length && timingSafeEqual(key, expected));
    });
  });
}

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Contraseña aleatoria legible (sin caracteres ambiguos). */
export function randomPassword(length = 18): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

/** Token firmado con HMAC-SHA256 (formato payload.firma). No lleva el rol: el servidor lo lee del registro del usuario en cada petición. */
export function signToken(payload: TokenPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}`;
}

export function verifyToken(token: string, secret: string, nowMs: number): TokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    return typeof payload.sub === 'string' && typeof payload.exp === 'number' && payload.exp > nowMs ? payload : null;
  } catch {
    return null;
  }
}
