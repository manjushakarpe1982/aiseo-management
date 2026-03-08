'use client';

import { useEffect, useState } from 'react';

interface User {
  UserID: number;
  FullName: string;
  Email: string;
  Role: string;
  IsActive: boolean;
  CreatedAt: string | null;
  LastLoginAt: string | null;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === 'Admin'
      ? 'bg-primary text-white'
      : role === 'Editor'
      ? 'bg-warning-light text-amber-800 border border-amber-200'
      : 'bg-surface2 text-muted border border-border';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-semibold ${cls}`}>
      {role}
    </span>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // New user form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('Editor');
  const [formError, setFormError] = useState('');

  // Inline edit state: { [userId]: { role?, password? } }
  const [editingPwd, setEditingPwd] = useState<Record<number, string>>({});

  async function loadUsers() {
    setLoading(true);
    try {
      const r = await fetch('/api/users');
      if (!r.ok) {
        const d = await r.json();
        setError(d.error || 'Failed to load users');
      } else {
        setUsers(await r.json());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleToggleActive(user: User) {
    setSaving(true);
    await fetch(`/api/users/${user.UserID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !user.IsActive }),
    });
    await loadUsers();
    setSaving(false);
  }

  async function handleRoleChange(user: User, role: string) {
    setSaving(true);
    await fetch(`/api/users/${user.UserID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    await loadUsers();
    setSaving(false);
  }

  async function handlePasswordReset(userId: number) {
    const pwd = editingPwd[userId];
    if (!pwd || pwd.length < 8) {
      alert('Password must be at least 8 characters');
      return;
    }
    setSaving(true);
    const r = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    });
    if (r.ok) {
      setEditingPwd((prev) => { const copy = { ...prev }; delete copy[userId]; return copy; });
      alert('Password updated successfully');
    } else {
      const d = await r.json();
      alert(d.error || 'Failed to update password');
    }
    setSaving(false);
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: newName, email: newEmail, password: newPassword, role: newRole }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFormError(d.error || 'Failed to create user');
      } else {
        setNewName(''); setNewEmail(''); setNewPassword(''); setNewRole('Editor');
        setShowAdd(false);
        await loadUsers();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-slide">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">User Management</h1>
          <p className="text-sm text-muted mt-0.5">Manage who can access the AISEO system</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 bg-primary hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add User
        </button>
      </div>

      {/* Add User Form */}
      {showAdd && (
        <div className="bg-surface border border-border rounded-xl p-6 mb-6 shadow-card">
          <h2 className="text-base font-semibold text-ink mb-4">New User</h2>
          <form onSubmit={handleAddUser}>
            {formError && (
              <p className="text-sm text-danger bg-danger-light border border-red-200 rounded-lg px-4 py-2.5 mb-4">
                {formError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold text-ink-2 mb-1">Full Name</label>
                <input
                  type="text" value={newName} onChange={(e) => setNewName(e.target.value)} required
                  placeholder="Jane Smith"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink-2 mb-1">Email</label>
                <input
                  type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required
                  placeholder="jane@boldpreciousmetals.com"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink-2 mb-1">Password</label>
                <input
                  type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required
                  placeholder="Min 8 characters"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink-2 mb-1">Role</label>
                <select
                  value={newRole} onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option>Admin</option>
                  <option>Editor</option>
                  <option>Viewer</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit" disabled={saving}
                className="bg-primary hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
              >
                {saving ? 'Creating…' : 'Create User'}
              </button>
              <button
                type="button" onClick={() => setShowAdd(false)}
                className="text-sm text-muted hover:text-ink px-4 py-2 rounded-lg border border-border bg-surface hover:bg-surface2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <svg className="w-6 h-6 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : error ? (
        <div className="bg-danger-light border border-red-200 rounded-xl p-6 text-danger text-sm">{error}</div>
      ) : (
        <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface2 border-b border-border">
                <th className="text-left px-4 py-3 font-semibold text-ink-2">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-2">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-2">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-2">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-2">Last Login</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-2">Created</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.UserID} className={`hover:bg-surface2 transition-colors ${!u.IsActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center flex-shrink-0">
                        <span className="text-primary font-bold text-sm">
                          {u.FullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium text-ink">{u.FullName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted font-mono text-sm">{u.Email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.Role}
                      onChange={(e) => handleRoleChange(u, e.target.value)}
                      disabled={saving}
                      className="text-sm font-semibold border-0 bg-transparent focus:outline-none cursor-pointer"
                    >
                      <option>Admin</option>
                      <option>Editor</option>
                      <option>Viewer</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-semibold ${
                      u.IsActive
                        ? 'bg-success-light text-green-800 border border-green-200'
                        : 'bg-surface2 text-muted border border-border'
                    }`}>
                      {u.IsActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted text-sm">{fmtDate(u.LastLoginAt)}</td>
                  <td className="px-4 py-3 text-muted text-sm">{fmtDate(u.CreatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Toggle Active */}
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={saving}
                        className={`text-sm font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                          u.IsActive
                            ? 'border-border text-muted hover:text-danger hover:border-red-200 hover:bg-danger-light'
                            : 'border-green-200 text-green-700 bg-success-light hover:bg-green-100'
                        }`}
                      >
                        {u.IsActive ? 'Deactivate' : 'Activate'}
                      </button>

                      {/* Reset Password */}
                      {editingPwd[u.UserID] !== undefined ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="password"
                            value={editingPwd[u.UserID]}
                            onChange={(e) => setEditingPwd((prev) => ({ ...prev, [u.UserID]: e.target.value }))}
                            placeholder="New password"
                            className="text-sm px-2 py-1 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary/40 w-28"
                          />
                          <button
                            onClick={() => handlePasswordReset(u.UserID)}
                            disabled={saving}
                            className="text-sm font-medium px-2 py-1 rounded bg-primary text-white hover:bg-blue-700 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingPwd((prev) => { const c = { ...prev }; delete c[u.UserID]; return c; })}
                            className="text-sm text-muted hover:text-ink"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingPwd((prev) => ({ ...prev, [u.UserID]: '' }))}
                          className="text-sm font-medium px-2.5 py-1 rounded-lg border border-border text-muted hover:text-ink hover:bg-surface2 transition-colors"
                        >
                          Reset Pwd
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
