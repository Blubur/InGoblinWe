// Cliente mínimo para hablar con la API a través del proxy de la web (mismo origen).
// El token CSRF se obtiene de /auth/me o del login y se envía en cada petición que modifica datos.

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; message: string };

export interface Me {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: 'owner' | 'user' | 'admin' | 'member';
    canCreateCommunities: boolean;
  };
  csrfToken: string;
}

export interface CommunitySummary {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  primaryHost: string | null;
  memberCount: number;
  createdAt: string;
}

/** Cuenta tal como la ve el propietario en su panel. */
export interface AccountSummary {
  id: string;
  email: string;
  displayName: string;
  isPlatformOwner: boolean;
  canCreateCommunities: boolean;
  status: 'active' | 'disabled';
  createdAt: string;
  adminOf: number;
}

export interface CreatedCommunity {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  host: string;
}

let csrfToken: string | undefined;

export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

interface ErrorBody {
  message?: unknown;
  errors?: unknown;
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const { message, errors } = body as ErrorBody;
    if (Array.isArray(errors) && errors.length > 0) {
      const details = errors
        .map((item) => (item && typeof item === 'object' ? (item as { message?: unknown }).message : undefined))
        .filter((text): text is string => typeof text === 'string');
      if (details.length > 0) return details.join(' · ');
    }
    if (typeof message === 'string') return message;
  }
  return `Error inesperado (HTTP ${status})`;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, message: 'No se pudo conectar con el servidor' };
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) return { ok: false, status: response.status, message: messageFrom(body, response.status) };
  return { ok: true, status: response.status, data: body as T };
}
