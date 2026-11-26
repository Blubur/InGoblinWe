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

/** Respuesta de error siempre en JSON, con el formato que espera el cliente. */
function failure(status: number, message: string): Response {
  return Response.json({ statusCode: status, message }, { status, headers: { 'cache-control': 'no-store' } });
}

async function forward(req: NextRequest): Promise<Response> {
  try {
    return await forwardToApi(req);
  } catch (error) {
    // Cualquier fallo inesperado del proxy: se registra (sin cabeceras ni secretos) y se responde en JSON.
    console.error('[proxy] error inesperado:', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return failure(500, 'Error interno del proxy');
  }
}

async function forwardToApi(req: NextRequest): Promise<Response> {
  const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';
  const secret = process.env.PROXY_SHARED_SECRET;

  let target: URL;
  try {
    target = new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, apiUrl);
  } catch {
    console.error('[proxy] API_URL no es una URL válida: debe empezar por https:// (o http://)');
    return failure(500, 'Configuración del servidor incorrecta');
  }

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
  } catch (error) {
    console.error('[proxy] no se pudo contactar con la API:', error instanceof Error ? error.name : String(error));
    return failure(502, 'No se pudo contactar con la API');
  }

  const contentType = upstream.headers.get('content-type');
  if (upstream.status >= 500) {
    console.error(`[proxy] la API respondió ${upstream.status} a ${req.method} ${req.nextUrl.pathname}`);
    // Un fallo de la API que no viene en JSON (por ejemplo, la página de error de Railway) se traduce a JSON.
    if (!contentType?.includes('application/json')) {
      return failure(upstream.status, 'La API no respondió correctamente');
    }
  }

  const responseHeaders = new Headers();
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
