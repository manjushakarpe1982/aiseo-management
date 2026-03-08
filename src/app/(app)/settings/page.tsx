'use client';

import { useEffect, useState } from 'react';

interface Setting {
  key: string;
  value: string;       // masked for secret keys
  isSet: boolean;
  description: string | null;
  updatedAt: string | null;
}

function fmtDate(d: string | null) {
  if (!d) return 'Never';
  return new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── EyeIcon ──────────────────────────────────────────────────────────────────
function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

// ─── SettingRow ───────────────────────────────────────────────────────────────
function SettingRow({ setting, onSaved }: { setting: Setting; onSaved: () => void }) {
  const [editing, setEditing]   = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [showVal, setShowVal]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [saved, setSaved]       = useState(false);

  const isSecret = setting.key.includes('KEY') || setting.key.includes('SECRET');

  function openEdit() {
    setInputVal('');   // never pre-fill secret — user must re-type
    setError('');
    setSaved(false);
    setEditing(true);
  }

  async function handleSave() {
    if (!inputVal.trim()) { setError('Value cannot be empty'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: setting.key, value: inputVal.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSaved(true);
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface rounded-2xl border border-border shadow-card p-6 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {/* Status dot */}
          <div className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${setting.isSet ? 'bg-green-500' : 'bg-red-400'}`} />
          <div className="min-w-0">
            <p className="font-semibold font-mono text-ink text-sm">{setting.key}</p>
            {setting.description && (
              <p className="text-muted text-sm mt-0.5">{setting.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {setting.isSet ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success-light text-green-700 text-xs font-semibold">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-danger-light text-red-700 text-xs font-semibold">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Not Set
            </span>
          )}
          {!editing && (
            <button
              onClick={openEdit}
              className="px-3 py-1.5 text-sm font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
            >
              {setting.isSet ? 'Update' : 'Set Value'}
            </button>
          )}
        </div>
      </div>

      {/* Current value (masked) */}
      {setting.isSet && !editing && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-surface2 rounded-xl border border-border">
          <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <code className="text-sm text-ink-2 font-mono flex-1">{setting.value}</code>
          <p className="text-xs text-muted">Last updated: {fmtDate(setting.updatedAt)}</p>
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="space-y-3 pt-1">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">New Value</label>
            <div className="relative">
              <input
                type={isSecret && !showVal ? 'password' : 'text'}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder={isSecret ? 'sk-ant-…' : 'Enter value'}
                autoFocus
                className="w-full px-3 py-2.5 pr-10 rounded-xl border border-border bg-surface2 text-ink text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              {isSecret && (
                <button
                  type="button"
                  onClick={() => setShowVal((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
                  title={showVal ? 'Hide' : 'Show'}
                >
                  <EyeIcon open={showVal} />
                </button>
              )}
            </div>
            {isSecret && (
              <p className="text-xs text-muted mt-1.5">
                The value is stored in the database and never exposed in full — only the last 6 characters are shown.
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-danger-light border border-red-200 rounded-xl text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex gap-2.5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {saving && (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2 border border-border text-ink-2 text-sm font-medium rounded-xl hover:bg-surface2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Saved confirmation */}
      {saved && !editing && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-success-light border border-green-200 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Saved successfully. The new value will be used on the next scan.
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setSettings(d.settings ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6 animate-fade-slide max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display text-ink">Settings</h1>
        <p className="text-muted text-sm mt-1">
          Master configuration variables stored in the database.
          Values are read by the Python scanner at the start of each scan.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-2xl text-sm text-ink-2">
        <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>
          Secret values (API keys) are <strong>never shown in full</strong> — only the last 6 characters
          are displayed for verification. To update a key, type the new value and save.
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-4 bg-danger-light border border-red-200 rounded-2xl text-sm text-danger">
          Failed to load settings: {error}
        </div>
      ) : settings.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-border p-8 text-center text-muted text-sm">
          No settings found. Run{' '}
          <code className="bg-surface2 px-1.5 py-0.5 rounded font-mono text-ink-2">
            python run_scan.py setup
          </code>{' '}
          to seed defaults.
        </div>
      ) : (
        <div className="space-y-4">
          {settings.map((s) => (
            <SettingRow key={s.key} setting={s} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}
