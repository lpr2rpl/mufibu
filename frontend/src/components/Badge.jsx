import React from 'react';

const VARIANTS = {
  draft:            { bg: '#f5f5f5',   color: '#555' },
  pending_approval: { bg: '#fff8e1',   color: '#f57f17' },
  approved:         { bg: '#e8f5e9',   color: '#2e7d32' },
  rejected:         { bg: '#ffebee',   color: '#c62828' },
  posted:           { bg: '#e3f2fd',   color: '#1565c0' },
  active:           { bg: '#e8f5e9',   color: '#2e7d32' },
  inactive:         { bg: '#ffebee',   color: '#c62828' },
  global:           { bg: '#e8eaf6',   color: '#283593' },
  tenant:           { bg: '#f3e5f5',   color: '#6a1b9a' },
};

export default function Badge({ label, variant }) {
  const style = VARIANTS[variant] || VARIANTS[label?.toLowerCase()] || { bg: '#f5f5f5', color: '#555' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 9px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      background: style.bg,
      color: style.color,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
