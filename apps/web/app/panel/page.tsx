'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  setCsrfToken,
  type AccountSummary,
  type CommunitySummary,
  type CreatedCommunity,
  type Me,
} from '../../lib/api';

export default function PanelPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me['user'] | undefined>();
  const [communities, setCommunities] = useState<CommunitySummary[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [accountsError, setAccountsError] = useState<string | undefined>();

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [formError, setFormError] = useState<string | undefined>();
  const [created, setCreated] = useState<CreatedCommunity | undefined>();
  const [busy, setBusy] = useState(false);

  // El propietario ve todas las comunidades; el resto, solo las que administra.
  const loadCommunities = useCallback(async (role: Me['user']['role']) => {
    const result = await api<{ communities: CommunitySummary[] }>(role === 'owner' ? '/communities' : '/communities/mine');
    if (result.ok) {
      setCommunities(result.data.communities);
      setLoadError(undefined);
    } else {
      setLoadError(result.message);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    const result = await api<{ users: AccountSummary[] }>('/platform/users');
    if (result.ok) {
      setAccounts(result.data.users);
      setAccountsError(undefined);
    } else {
      setAccountsError(result.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await api<Me>('/auth/me');
      if (cancelled) return;
      if (!result.ok) {
        router.replace('/login');
        return;
      }
      setCsrfToken(result.data.csrfToken);
      setMe(result.data.user);
      await loadCommunities(result.data.user.role);
      if (result.data.user.role === 'owner') await loadAccounts();
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadCommunities, loadAccounts]);

  async function createCommunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(undefined);
    setCreated(undefined);
    const body: { slug: string; name: string; adminEmail?: string } = { slug, name };
    // Solo el propietario puede indicar otro administrador; para el resto es siempre su cuenta.
    if (me?.role === 'owner' && adminEmail.trim()) body.adminEmail = adminEmail;
    const result = await api<{ community: CreatedCommunity }>('/communities', { method: 'POST', body });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setCreated(result.data.community);
    setSlug('');
    setName('');
    setAdminEmail('');
    if (me) {
      await loadCommunities(me.role);
      if (me.role === 'owner') await loadAccounts();
    }
  }

  async function toggleStatus(community: CommunitySummary) {
    const status = community.status === 'active' ? 'suspended' : 'active';
    const result = await api(`/communities/${community.id}/status`, { method: 'PATCH', body: { status } });
    if (!result.ok) {
      setLoadError(result.message);
      return;
    }
    if (me) await loadCommunities(me.role);
  }

  async function toggleCreator(account: AccountSummary) {
    const result = await api(`/platform/users/${account.id}`, {
      method: 'PATCH',
      body: { canCreateCommunities: !account.canCreateCommunities },
    });
    if (!result.ok) {
      setAccountsError(result.message);
      return;
    }
    await loadAccounts();
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setCsrfToken(undefined);
    router.replace('/login');
  }

  if (!me) {
    return (
      <main className="wide">
        <p className="subtitle">Cargando…</p>
      </main>
    );
  }

  const isOwner = me.role === 'owner';

  return (
    <main className="wide">
      <header className="topbar">
        <div>
          <h1>{isOwner ? 'Panel central' : 'Mis comunidades'}</h1>
          <p className="subtitle">Sesión de {me.displayName}</p>
        </div>
        <button type="button" className="secondary" onClick={logout}>
          Salir
        </button>
      </header>

      <section>
        <h2>Nueva comunidad</h2>
        {!me.canCreateCommunities ? (
          <p className="notice">
            Todavía no tienes permiso para crear comunidades. Pídeselo al propietario de la plataforma; cuando te lo
            active, recarga esta página.
          </p>
        ) : (
        <form className="card form" onSubmit={createCommunity}>
          <label>
            Identificador (subdominio)
            <input
              required
              minLength={3}
              maxLength={63}
              pattern="[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?"
              placeholder="mi-foro"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
          <label>
            Nombre
            <input required maxLength={80} placeholder="Mi foro" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {isOwner && (
            <label>
              Email del administrador <span className="muted">(opcional; por defecto, tu cuenta)</span>
              <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </label>
          )}
          {formError && <p className="error">{formError}</p>}
          {created && (
            <p className="success">
              Comunidad «{created.name}» creada en <code>{created.host}</code>.
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? 'Creando…' : 'Crear comunidad'}
          </button>
        </form>
        )}
      </section>

      <section>
        <h2>{isOwner ? 'Todas las comunidades' : 'Tus comunidades'}</h2>
        {loadError && <p className="error">{loadError}</p>}
        {communities.length === 0 && !loadError ? (
          <p className="muted">{isOwner ? 'Todavía no hay comunidades.' : 'Todavía no administras ninguna comunidad.'}</p>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Dirección</th>
                  <th>Estado</th>
                  <th>Miembros</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {communities.map((community) => (
                  <tr key={community.id}>
                    <td>{community.name}</td>
                    <td>
                      <code>{community.primaryHost ?? '—'}</code>
                    </td>
                    <td>
                      <span className={`badge ${community.status}`}>
                        {community.status === 'active' ? 'Activa' : 'Suspendida'}
                      </span>
                    </td>
                    <td>{community.memberCount}</td>
                    <td className="actions">
                      <button type="button" className="secondary" onClick={() => toggleStatus(community)}>
                        {community.status === 'active' ? 'Suspender' : 'Reactivar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {isOwner && (
        <section>
          <h2>Cuentas</h2>
          {accountsError && <p className="error">{accountsError}</p>}
          {accounts.length === 0 && !accountsError ? (
            <p className="muted">Todavía no hay cuentas.</p>
          ) : (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Administra</th>
                    <th>Puede crear</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.displayName}</td>
                      <td>{account.email}</td>
                      <td>{account.adminOf}</td>
                      <td>
                        {account.isPlatformOwner ? (
                          <span className="badge active">Propietario</span>
                        ) : (
                          <span className={`badge ${account.canCreateCommunities ? 'active' : 'neutral'}`}>
                            {account.canCreateCommunities ? 'Sí' : 'No'}
                          </span>
                        )}
                      </td>
                      <td className="actions">
                        {!account.isPlatformOwner && (
                          <button type="button" className="secondary" onClick={() => toggleCreator(account)}>
                            {account.canCreateCommunities ? 'Retirar permiso' : 'Dar permiso'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
