import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function SessionWarning() {
  const { sessionExpiring, extendSession, dismissSessionWarning } = useAuth();

  if (!sessionExpiring) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#e65100',
      color: '#fff',
      padding: '12px 20px',
      borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      fontSize: 14,
      whiteSpace: 'nowrap',
    }}>
      <span>Your session expires in less than 5 minutes. Save your work.</span>
      <button
        onClick={extendSession}
        style={{
          background: '#fff',
          color: '#e65100',
          border: 'none',
          borderRadius: 4,
          padding: '5px 14px',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 13,
        }}>
        Extend
      </button>
      <button
        onClick={dismissSessionWarning}
        style={{
          background: 'transparent',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.5)',
          borderRadius: 4,
          padding: '5px 10px',
          cursor: 'pointer',
          fontSize: 13,
        }}>
        Dismiss
      </button>
    </div>
  );
}
