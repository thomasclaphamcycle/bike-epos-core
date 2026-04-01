import { Link } from "react-router-dom";
import { useCustomerAccount } from "../customerAccount/CustomerAccountContext";
import {
  publicSiteContactDetails,
  publicSiteNavigation,
  publicSitePaths,
  publicSiteTrustBadges,
  type PublicSiteNavKey,
} from "../features/publicSite/siteContent";

export const PublicSiteLayout = ({
  children,
  currentNav,
}: {
  children: React.ReactNode;
  currentNav?: PublicSiteNavKey;
}) => {
  const { logout, session } = useCustomerAccount();

  return (
    <div className="public-site-layout">
      <header className="public-site-header">
        <div className="public-site-header-shell">
          <Link to={publicSitePaths.home} className="public-site-brand">
            <span className="public-site-brand-mark">{publicSiteContactDetails.businessName}</span>
            <span className="public-site-brand-copy">
              Workshop-first online booking and secure repair updates
            </span>
          </Link>

          <nav className="public-site-nav" aria-label="Customer site navigation">
            {publicSiteNavigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={item.key === currentNav ? "public-site-nav-link active" : "public-site-nav-link"}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="public-site-header-actions">
            {session.authenticated ? (
              <div className="public-site-account-chip">
                <Link className="button-link" to={publicSitePaths.account}>
                  {session.customer?.firstName ? `${session.customer.firstName}'s account` : "Customer account"}
                </Link>
                <button type="button" className="public-site-logout-button" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
            ) : (
              <Link className="button-link button-link-secondary" to={publicSitePaths.accountLogin}>
                Customer access
              </Link>
            )}
            <Link className="button-link" to={publicSitePaths.bookWorkshop}>
              Book workshop
            </Link>
            <Link className="public-site-login-link" to="/login">
              Staff login
            </Link>
          </div>
        </div>

        <div className="public-site-trust-strip" role="list" aria-label="Customer trust highlights">
          {publicSiteTrustBadges.map((badge) => (
            <span key={badge} className="public-site-trust-pill" role="listitem">
              {badge}
            </span>
          ))}
        </div>
      </header>

      <main className="public-site-main">{children}</main>

      <footer className="public-site-footer">
        <div className="public-site-footer-shell">
          <section className="public-site-footer-panel">
            <p className="public-site-footer-kicker">Workshop-first online layer</p>
            <h2>From booking to collection, the customer journey stays clearer and more connected.</h2>
            <p>
              Phase 1 now gives CorePOS a practical public entry point for workshop customers without
              rebuilding the proven internal workflow underneath.
            </p>
          </section>

          <section className="public-site-footer-card">
            <strong>Visit or call</strong>
            <p>{publicSiteContactDetails.phone}</p>
            <p>{publicSiteContactDetails.email}</p>
            {publicSiteContactDetails.addressLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>

          <section className="public-site-footer-card">
            <strong>Workshop timing</strong>
            {publicSiteContactDetails.openingHours.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p>Secure booking, approval, and collection updates continue through dedicated links.</p>
          </section>

          <section className="public-site-footer-card">
            <strong>Quick links</strong>
            <Link to={publicSitePaths.services}>Browse services</Link>
            <Link to={publicSitePaths.repairs}>See the repair journey</Link>
            <Link to={publicSitePaths.bookWorkshop}>Start a booking</Link>
            <Link to={publicSitePaths.account}>Customer account</Link>
            <Link to={publicSitePaths.contact}>Contact the shop</Link>
          </section>
        </div>
      </footer>
    </div>
  );
};
