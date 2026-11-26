'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, setCsrfToken, type Me } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const result = await api<Me>('/auth/login', { method: 'POST', body: { email, password } });
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    setCsrfToken(result.data.csrfToken);
    router.push('/panel');
  }

  return (
    <main>
      <h1>Panel central</h1>
      <p className="subtitle">Entra con la cuenta del propietario de la plataforma</p>

      <form className="card form" onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <p className="hint">
        <Link href="/">Estado de la infraestructura</Link>
      </p>
    </main>
  );
}
