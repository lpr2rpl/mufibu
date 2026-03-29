import React from 'react';

export default function ConfirmDialog({ message, onConfirm, onCancel, danger }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: 24, width: 360,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <p style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '7px 16px', border: '1px solid #ddd', borderRadius: 6,
            background: '#fff', cursor: 'pointer', fontSize: 14,
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: '7px 16px', border: 'none', borderRadius: 6,
            background: danger ? '#c62828' : '#1a237e',
            color: '#fff', cursor: 'pointer', fontSize: 14,
          }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
