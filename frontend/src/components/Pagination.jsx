import React from 'react';

const btnStyle = (disabled) => ({
  padding: '6px 14px', border: '1px solid #ddd', borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  background: disabled ? '#f5f5f5' : '#fff',
  color: disabled ? '#bbb' : '#333', fontSize: 13,
});

export default function Pagination({ page, onPage, hasMore }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee',
    }}>
      <button style={btnStyle(page === 0)} disabled={page === 0}
        onClick={() => onPage(page - 1)}>
        &larr; Previous
      </button>
      <span style={{ fontSize: 13, color: '#666' }}>Page {page + 1}</span>
      <button style={btnStyle(!hasMore)} disabled={!hasMore}
        onClick={() => onPage(page + 1)}>
        Next &rarr;
      </button>
    </div>
  );
}
