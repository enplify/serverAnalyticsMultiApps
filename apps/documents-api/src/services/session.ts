import jwt from "jsonwebtoken";

export type DocsSession = {
  curatorUserId: number;
  email: string;
  fullName: string;
  curatorGroupId: string;
};

export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 15 * 60);

export function signSession(payload: DocsSession): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }

  return jwt.sign(payload, secret, {
    expiresIn: SESSION_TTL_SECONDS
  });
}

export function verifySession(token: string): DocsSession {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }

  return jwt.verify(token, secret) as DocsSession;
}
