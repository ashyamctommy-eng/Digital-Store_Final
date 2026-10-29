"use client";

import { API_BASE } from "./payments";

export interface LocalAccount {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export class LocalAuthError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "LocalAuthError";
    this.code = code;
  }
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object") {
    const message =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : "The account service could not be reached.";
    const code =
      body && typeof body === "object" && typeof body.errorCode === "string"
        ? body.errorCode
        : "AUTH_SERVICE_UNAVAILABLE";
    throw new LocalAuthError(message, code);
  }
  return body as Record<string, unknown>;
}

export async function getLocalAccount(): Promise<LocalAccount | null> {
  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await parseResponse(response);
    const account = body.user;
    if (body.authenticated !== true || !account || typeof account !== "object") return null;
    const candidate = account as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.email !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.email_verified !== "boolean"
    ) {
      return null;
    }
    return {
      id: candidate.id,
      email: candidate.email,
      name: candidate.name,
      emailVerified: candidate.email_verified,
    };
  } catch {
    return null;
  }
}

async function postAccount(
  endpoint: "signup" | "login" | "logout" | "verify" | "verification-resend",
  payload: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/${endpoint}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    throw new LocalAuthError(
      "The account service could not be reached. Please try again.",
      "AUTH_SERVICE_UNAVAILABLE",
    );
  }
  return parseResponse(response);
}

function readAccount(body: Record<string, unknown>): LocalAccount {
  const value = body.user;
  if (!value || typeof value !== "object") {
    throw new LocalAuthError("The account service returned an invalid response.", "INVALID_RESPONSE");
  }
  const user = value as Record<string, unknown>;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.name !== "string" ||
    typeof user.email_verified !== "boolean"
  ) {
    throw new LocalAuthError("The account service returned an invalid response.", "INVALID_RESPONSE");
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.email_verified,
  };
}

export async function createLocalAccount(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  const body = await postAccount("signup", { name, email, password });
  if (body.verification_required !== true) {
    throw new LocalAuthError("The account service returned an invalid response.", "INVALID_RESPONSE");
  }
}

export async function signInLocalAccount(
  email: string,
  password: string,
): Promise<LocalAccount> {
  return readAccount(await postAccount("login", { email, password }));
}

export async function verifyLocalAccount(token: string): Promise<LocalAccount> {
  return readAccount(await postAccount("verify", { token }));
}

export async function resendLocalVerification(email: string): Promise<void> {
  await postAccount("verification-resend", { email });
}

export async function signOutLocalAccount(): Promise<void> {
  await postAccount("logout");
}
