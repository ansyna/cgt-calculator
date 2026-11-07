export default function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav>
      <ul className="pagination">
        <li className={`page-item ${page === 0 ? 'disabled' : ''}`}>
          <button type="button" className="page-link" onClick={() => onChange(page - 1)}>
            ‹
          </button>
        </li>
        {Array.from({ length: totalPages }, (_, i) => (
          <li key={i} className={`page-item ${i === page ? 'active' : ''}`}>
            <button type="button" className="page-link" onClick={() => onChange(i)}>
              {i + 1}
            </button>
          </li>
        ))}
        <li className={`page-item ${page >= totalPages - 1 ? 'disabled' : ''}`}>
          <button type="button" className="page-link" onClick={() => onChange(page + 1)}>
            ›
          </button>
        </li>
      </ul>
    </nav>
  );
}
