import { ApiError } from '../api';

/** Shows an API error, listing field validation errors like Laravel's "Whoops!" box. */
export default function FieldErrors({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const fieldErrors = error instanceof ApiError ? Object.values(error.errors).flat() : [];
  return (
    <div className="alert alert-danger" role="alert">
      {fieldErrors.length > 0 ? (
        <>
          <strong>Whoops!</strong> There were some problems with your input.
          <ul className="mb-0 mt-2">
            {fieldErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </>
      ) : (
        message
      )}
    </div>
  );
}
