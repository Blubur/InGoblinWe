import type { NextRequest } from 'next/server';

// Proxy hacia la API. El navegador solo habla con la web (mismo origen), así que
// no hace falta CORS y las cookies de sesión quedan atadas al host de la web.
//
// La API decide a qué comunidad va cada petición por el host, y desde aquí ella
// solo ve el host de la web. Por eso se reenvía el host original en una cabecera
// junto con el secreto compartido: la API solo hace caso a esa cabecera si el
// secreto coincide (ver apps/api/src/tenant/forwarded-host.ts).
export const dynamic = 'force-dynamic';

const FORWARDED_HOST_HEADER = 'x-goblins-host';
const PROXY_SECRET_HEADER = 'x-goblins-proxy-secret';
const PASS_THROUGH = ['cookie', 'content-type', 'accept', 'origin', 'x-csrf-token'];
const TIMEOUT_MS = 10_000;

async function forward(req: NextRequest): Promise<Response> {
  const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';
  const secret = process.env.PROXY_SHARED_SECRET;

  const target = new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, apiUrl);

  const headers = new Headers();
  for (const name of PASS_THROUGH) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const host = req.headers.get('host');
  if (host) headers.set(FORWARDED_HOST_HEADER, host);
  if (secret) headers.set(PROXY_SECRET_HEADER, secret);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return Response.json({ statusCode: 502, message: 'No se pudo contactar con la API' }, { status: 502 });
  }

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
  responseHeaders.set('cache-control', 'no-store');

  const body = upstream.status === 204 || upstream.status === 304 ? null : await upstream.text();
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
