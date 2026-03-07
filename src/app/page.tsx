'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { DashboardStats } from '@/lib/types';
import { ScanStatusBadge } from '@/components/Badge';

function StatCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-6 shadow-card flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-muted text-sm font-medium">{label}</p>
        <p className="text-ink text-3xl font-bold font-display mt-0.5">{value}</p>
        {sub && <p className="text-muted text-xs mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setError('Failed to load dashboard'));
  }, []);

  if (error) return (
    <div className="text-danger bg-danger-light border border-red-200 rounded-xl p-4">{error}</div>
  );

  if (!stats) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-slide">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">Dashboard</h1>
          <p className="text-muted text-sm mt-1">AISEO Management — boldpreciousmetals.com</p>
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <StatCard
          label="Total Scans"
          value={stats.totalScans}
          color="bg-primary-light"
          icon={
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <StatCard
          label="Open Issues"
          value={stats.openIssues}
          sub="Yet to Act"
          color="bg-blue-50"
          icon={
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        <StatCard
          label="High Severity Cannib."
          value={stats.highSeverityCannibalization}
          sub="Cannibalization — High"
          color="bg-danger-light"
          icon={
            <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          }
        />
        <StatCard
          label="High Priority Content"
          value={stats.highPriorityImprovements}
          sub="Content Improvements — High"
          color="bg-warning-light"
          icon={
            <svg className="w-5 h-5 text-warning" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          }
        />
      </div>

      {/* Recent scans */}
      <div className="bg-surface rounded-2xl border border-border shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold font-display text-ink">Recent Scans</h2>
          <Link href="/scans" className="text-primary text-sm font-medium hover:underline">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface2">
                <th className="text-left px-6 py-3 text-muted font-medium">Name</th>
                <th className="text-left px-4 py-3 text-muted font-medium">Status</th>
                <th className="text-left px-4 py-3 text-muted font-medium">Started</th>
                <th className="text-right px-4 py-3 text-muted font-medium">URLs</th>
                <th className="text-right px-4 py-3 text-muted font-medium">Cannib.</th>
                <th className="text-right px-6 py-3 text-muted font-medium">Content</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentScans.map((scan) => (
                <tr key={scan.ScanID} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                  <td className="px-6 py-4">
                    <Link
                      href={`/scans/${scan.ScanID}`}
                      className="font-medium text-ink hover:text-primary transition-colors"
                    >
                      {scan.ScanName}
                    </Link>
                    <p className="text-muted text-xs mt-0.5">#{scan.ScanID}</p>
                  </td>
                  <td className="px-4 py-4">
                    <ScanStatusBadge status={scan.Status} />
                  </td>
                  <td className="px-4 py-4 text-muted">{fmtDate(scan.StartedAt)}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm">{scan.URLsScraped ?? '—'}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm">{scan.CannibalizationCount ?? 0}</td>
                  <td className="px-6 py-4 text-right font-mono text-sm">{scan.ImprovementCount ?? 0}</td>
                </tr>
              ))}
              {stats.recentScans.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted">
                    No scans yet.{' '}
                    <Link href="/scans/new" className="text-primary hover:underline">
                      Start one now →
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
