import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Plus Jakarta Sans', 'sans-serif'],
        body: ['Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        canvas: '#F4F6FA',
        surface: '#FFFFFF',
        surface2: '#F8F9FC',
        border: '#E2E7F0',
        'border-strong': '#C8D0E0',
        primary: '#2563EB',
        'primary-light': '#EFF4FF',
        accent: '#0EA5E9',
        success: '#10B981',
        'success-light': '#ECFDF5',
        warning: '#F59E0B',
        'warning-light': '#FFFBEB',
        danger: '#EF4444',
        'danger-light': '#FEF2F2',
        ink: '#0F172A',
        'ink-2': '#334155',
        muted: '#94A3B8',
        'muted-light': '#F1F5F9',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
        'card-md': '0 4px 12px 0 rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
}
export default config
