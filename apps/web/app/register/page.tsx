'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, setCsrfToken, type Me } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const result = await api<Me>('/auth/register', { method: 'POST', body: { email, displayName, password } });
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
      <h1>Crear cuenta</h1>
      <p className="subtitle">
        Con tu cuenta podrás gestionar tus comunidades. Para crear una nueva, el propietario de la plataforma tiene que
        activarte el permiso.
      </p>

      <form className="card form" onSubmit={submit}>
        <label>
          Nombre
          <input required maxLength={64} autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>

      <p className="hint">
        ¿Ya tienes cuenta? <Link href="/login">Entrar</Link>
      </p>
    </main>
  );
}
