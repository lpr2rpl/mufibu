import React from 'react';

const btnStyle = (disabled) => ({
  padding: '6px 14px', border: '1px solid #ddd', borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  background: disabled ? '#f5f5f5' : '#fff',
  color: disabled ? '#bbb' : '#333', fontSize: 13,
});

export default function Pagination({ page, onPage, hasMore, total, limit }) {
  const derivedHasMore = typeof total === 'number' && typeof limit === 'number'
    ? (page + 1) * limit < total
    : hasMore;
  const totalPages = typeof total === 'number' && typeof limit === 'number'
    ? Math.max(1, Math.ceil(total / limit))
    : null;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee',
    }}>
      <button style={btnStyle(page === 0)} disabled={page === 0}
        onClick={() => onPage(page - 1)}>
        &larr; Previous
      </button>
      <span style={{ fontSize: 13, color: '#666' }}>
        {totalPages ? `Page ${page + 1} of ${totalPages}` : `Page ${page + 1}`}
      </span>
      <button style={btnStyle(!derivedHasMore)} disabled={!derivedHasMore}
        onClick={() => onPage(page + 1)}>
        Next &rarr;
      </button>
    </div>
  );
}
