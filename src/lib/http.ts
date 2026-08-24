/**
 * Core HTTP layer for the unified Zennara panel.
 *
 * Every request in the panel goes through here so there is exactly one place
 * that knows the API origin, how the admin bearer token is attached, and what
 * an expired session looks like.
 */

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000").replace(/\/+$/, "");

export const API_ORIGIN = RAW_BASE;
export const API_BASE = `${RAW_BASE}/api`;

export const TOKEN_KEY = "zennara.derm.token";
export const ADMIN_KEY = "zennara.derm.data";
export const EXPIRY_KEY = "zennara.derm.tokenExpiry";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, admin: unknown, expiresAt?: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
  if (expiresAt) localStorage.setItem(EXPIRY_KEY, expiresAt);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

export function storedAdmin<T = unknown>(): T | null {
  const raw = localStorage.getItem(ADMIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** True when we hold a token that has not passed its stored expiry. */
export function hasLiveSession(): boolean {
  if (!getToken()) return false;
  const expiry = localStorage.getItem(EXPIRY_KEY);
  if (!expiry) return true;
  const at = new Date(expiry).getTime();
  if (Number.isNaN(at)) return true;
  return Date.now() < at;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  payload: unknown;
  constructor(message: string, status: number, payload?: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.code = code;
  }
}

/** Broadcast so the app shell can drop back to the login screen. */
const SESSION_EXPIRED_EVENT = "zennara:session-expired";
export function onSessionExpired(fn: () => void) {
  window.addEventListener(SESSION_EXPIRED_EVENT, fn);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, fn);
}

export type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    sp.append(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

type RequestOpts = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  /** Skip the Authorization header (login endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
};

/**
 * Returns the `data` payload of a standard `{ success, data }` envelope.
 * Use `requestRaw` when a caller also needs `stats`, `count` or `pagination`.
 */
export async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const body = await requestRaw<T>(path, opts);
  return body.data as T;
}

export type Envelope<T> = {
  success: boolean;
  message?: string;
  data?: T;
  count?: number;
  stats?: Record<string, unknown>;
  statistics?: Record<string, unknown>;
  pagination?: { currentPage: number; totalPages: number; totalUsers?: number; total?: number };
  [key: string]: unknown;
};

export async function requestRaw<T = unknown>(path: string, opts: RequestOpts = {}): Promise<Envelope<T>> {
  const { method = "GET", body, query, anonymous, signal } = opts;

  const headers: Record<string, string> = {};
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (!anonymous) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${withQuery(path, query)}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("Cannot reach the Zennara API. Check your connection.", 0, err);
  }

  let payload: Envelope<T> | null = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text) as Envelope<T>;
    } catch {
      payload = null;
    }
  }

  if (res.status === 401) {
    // A dead token must not leave the panel showing half-loaded screens.
    clearSession();
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  if (!res.ok || (payload && payload.success === false)) {
    const message = payload?.message || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, payload, payload?.code as string | undefined);
  }

  return payload ?? ({ success: true } as Envelope<T>);
}

/** Multipart upload helper — the backend expects raw FormData with the bearer token. */
export function upload<T = unknown>(path: string, form: FormData, method: "POST" | "PUT" = "POST") {
  return request<T>(path, { method, body: form });
}
