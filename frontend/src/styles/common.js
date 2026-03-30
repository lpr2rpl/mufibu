/** Shared table/form styles used across all data pages. */

export const card = {
  background: '#fff', borderRadius: 8, padding: 20,
  boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 16,
};

export const th = {
  textAlign: 'left', padding: '10px 12px', color: '#777',
  borderBottom: '2px solid #eee', fontSize: 12, fontWeight: 700,
};

export const td = {
  padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f5f5f5',
};

export const input = {
  width: '100%', padding: '8px 10px', border: '1px solid #ddd',
  borderRadius: 6, fontSize: 14,
};

export const label = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4,
};

export const btn = (bg) => ({
  padding: '7px 14px', background: bg || '#1a237e', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
});
