import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";

import { AppError } from "@/lib/errors/app-error";
import { getEnv } from "@/lib/config/env";

const SESSION_COOKIE = "fulltext-rss-reader_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

export type SessionUser = {
  id: string;
  username: string;
};

function getSigningKey() {
  return new TextEncoder().encode(getEnv().SESSION_SECRET);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSigningKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      algorithms: ["HS256"],
    });

    if (!payload.sub || typeof payload.username !== "string") {
      return null;
    }

    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

export async function requirePageUser() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireApiUser() {
  const user = await getSessionUser();

  if (!user) {
    throw new AppError({
      code: "AUTHENTICATION_REQUIRED",
      message: "请先登录。",
      status: 401,
    });
  }

  return user;
}
