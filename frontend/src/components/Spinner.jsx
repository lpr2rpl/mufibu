import React from 'react';

export default function Spinner({ size = 32, color = '#1a237e' }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `3px solid rgba(0,0,0,0.1)`,
      borderTopColor: color,
      animation: 'spin 0.7s linear infinite',
      display: 'inline-block',
    }} />
  );
}
