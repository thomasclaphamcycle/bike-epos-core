import { Link } from "react-router-dom";

type PlaceholderLink = {
  label: string;
  to: string;
};

export const NavigationPlaceholderPage = ({
  title,
  description,
  links = [],
}: {
  title: string;
  description: string;
  links?: PlaceholderLink[];
}) => {
  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>{title}</h1>
            <p className="muted-text">{description}</p>
          </div>
        </div>

        <p className="muted-text">
          This is a UX-0 navigation placeholder. The route is live so the finalized navigation can be used and tested,
          while the detailed workflow stays aligned with later roadmap work.
        </p>

        {links.length ? (
          <div className="dashboard-link-grid">
            {links.map((link) => (
              <Link key={link.to} className="button-link dashboard-link-card" to={link.to}>
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
};
