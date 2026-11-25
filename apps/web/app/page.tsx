// Página de estado de la Fase 1: comprueba que web, API, PostgreSQL y Redis están conectados.
export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';

type Check = { ok: boolean; latencyMs: number; error?: string };
type Readiness = { status: 'ok' | 'error'; checks: { database: Check; redis: Check } };
type Result = { readiness: Readiness } | { unreachable: string };

async function fetchReadiness(): Promise<Result> {
  try {
    const response = await fetch(`${API_URL}/api/v1/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    // Con un servicio caído la API responde 503 con el mismo formato de cuerpo.
    const body = (await response.json()) as Partial<Readiness>;
    if (body.checks) return { readiness: body as Readiness };
    return { unreachable: `Respuesta inesperada de la API (HTTP ${response.status})` };
  } catch (error) {
    const reason = error instanceof Error ? error.message || error.name : String(error);
    return { unreachable: `No se pudo contactar con la API en ${API_URL}: ${reason}` };
  }
}

function Row({ label, check }: { label: string; check?: Check }) {
  const state = check ? (check.ok ? 'ok' : 'fail') : 'unknown';
  return (
    <li className={`row ${state}`}>
      <span className="dot" aria-hidden="true" />
      <span className="label">{label}</span>
      <span className="detail">
        {check ? (check.ok ? `${check.latencyMs} ms` : (check.error ?? 'error')) : 'sin datos'}
      </span>
    </li>
  );
}

export default async function Home() {
  const result = await fetchReadiness();
  const readiness = 'readiness' in result ? result.readiness : undefined;
  const allOk = readiness?.status === 'ok';

  return (
    <main>
      <h1>Goblins</h1>
      <p className="subtitle">Estado de la infraestructura local</p>

      <ul className="checks">
        <Row label="Web" check={{ ok: true, latencyMs: 0 }} />
        <Row label="API" check={readiness ? { ok: true, latencyMs: 0 } : undefined} />
        <Row label="PostgreSQL" check={readiness?.checks.database} />
        <Row label="Redis" check={readiness?.checks.redis} />
      </ul>

      {'unreachable' in result && <p className="error">{result.unreachable}</p>}
      <p className={allOk ? 'summary ok' : 'summary fail'}>
        {allOk ? 'Todo en marcha.' : 'Hay servicios sin responder.'}
      </p>
    </main>
  );
}
