import { Link } from 'react-router-dom';

/**
 * Shared fallback composition, not a screen of its own: it is rendered when a
 * role reaches a route it cannot use (RF-20).
 */
export function ForbiddenNotice(): JSX.Element {
  return (
    <section className="screen">
      <div className="card">
        <h1>Not available</h1>
        <p>
          This area is not available for your role. Navigation and routes are
          restricted per role, and every API operation is verified on the server.
        </p>
        <p>
          <Link to="/">Return to your workspace</Link>
        </p>
      </div>
    </section>
  );
}
