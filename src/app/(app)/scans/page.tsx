'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Scan } from '@/lib/types';
import { ScanStatusBadge } from '@/components/Badge';

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function dur(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export default function ScansPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/scans')
      .then((r) => r.json())
      .then((data) => { setScans(data); setLoading(false); })
      .catch(() => { setError('Failed to load scans'); setLoading(false); });
  }, []);

  return (
    <div className="space-y-6 animate-fade-slide">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">Scans</h1>
          <p className="text-muted text-sm mt-1">{scans.length} scan{scans.length !== 1 ? 's' : ''} total</p>
        </div>
        <Link
          href="/scans/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Scan
        </Link>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-2xl border border-border shadow-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="p-6 text-danger">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface2">
                  <th className="text-left px-6 py-3 text-muted font-medium w-8">#</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Name</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Started</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Duration</th>
                  <th className="text-right px-4 py-3 text-muted font-medium">URLs</th>
                  <th className="text-right px-4 py-3 text-muted font-medium">Trees</th>
                  <th className="text-right px-4 py-3 text-muted font-medium">Cannib.</th>
                  <th className="text-right px-6 py-3 text-muted font-medium">Content</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr
                    key={scan.ScanID}
                    className="border-b border-border/50 hover:bg-surface2 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 text-muted font-mono text-sm">{scan.ScanID}</td>
                    <td className="px-4 py-4">
                      <Link
                        href={`/scans/${scan.ScanID}`}
                        className="font-medium text-ink hover:text-primary transition-colors"
                      >
                        {scan.ScanName}
                      </Link>
                      {scan.Notes && (
                        <p className="text-muted text-sm mt-0.5 truncate max-w-xs">{scan.Notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <ScanStatusBadge status={scan.Status} />
                    </td>
                    <td className="px-4 py-4 text-muted text-sm">{fmtDate(scan.StartedAt)}</td>
                    <td className="px-4 py-4 text-muted text-sm font-mono">{dur(scan.StartedAt, scan.EndedAt)}</td>
                    <td className="px-4 py-4 text-right font-mono">{scan.URLsScraped ?? '—'}</td>
                    <td className="px-4 py-4 text-right font-mono">{scan.TreesAnalysed ?? '—'}</td>
                    <td className="px-4 py-4 text-right font-mono">{(scan as any).CannibalizationCount ?? 0}</td>
                    <td className="px-6 py-4 text-right font-mono">{(scan as any).ImprovementCount ?? 0}</td>
                  </tr>
                ))}
                {scans.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-16 text-center text-muted">
                      No scans yet.{' '}
                      <Link href="/scans/new" className="text-primary hover:underline">
                        Run your first scan →
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
