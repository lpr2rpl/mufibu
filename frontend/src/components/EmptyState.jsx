import React from 'react';

export default function EmptyState({ message = 'No data', action }) {
  return (
    <div style={{
      padding: '48px 24px', textAlign: 'center', color: '#999',
    }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>&#9723;</div>
      <div style={{ fontSize: 15, marginBottom: action ? 16 : 0 }}>{message}</div>
      {action}
    </div>
  );
}
