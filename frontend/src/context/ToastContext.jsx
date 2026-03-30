import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const timers = useRef(new Map());

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timers.current.delete(id);
    }, duration);
    timers.current.set(id, timer);
    return id;
  }, []);

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (msg, dur) => addToast(msg, 'success', dur),
    error:   (msg, dur) => addToast(msg, 'error',   dur ?? 5000),
    info:    (msg, dur) => addToast(msg, 'info',    dur),
    warn:    (msg, dur) => addToast(msg, 'warn',    dur),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
};

const COLORS = {
  success: { bg: '#2e7d32', icon: '✓' },
  error:   { bg: '#c62828', icon: '✕' },
  warn:    { bg: '#e65100', icon: '!' },
  info:    { bg: '#1565c0', icon: 'i' },
};

function ToastContainer({ toasts, dismiss }) {
  if (!toasts.length) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      display: 'flex', flexDirection: 'column', gap: 10,
      zIndex: 9999, maxWidth: 360,
    }}>
      {toasts.map(t => {
        const c = COLORS[t.type] || COLORS.info;
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: c.bg, color: '#fff', borderRadius: 8,
            padding: '12px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            fontSize: 14, lineHeight: 1.4, animation: 'slideIn 0.2s ease',
          }}>
            <span style={{
              flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
              background: 'rgba(255,255,255,0.25)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
            }}>{c.icon}</span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button onClick={() => dismiss(t.id)} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0,
            }}>×</button>
          </div>
        );
      })}
    </div>
  );
}
