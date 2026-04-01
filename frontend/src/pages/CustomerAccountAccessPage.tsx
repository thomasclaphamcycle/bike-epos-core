import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiPost } from "../api/client";
import { PublicSiteLayout } from "../components/PublicSiteLayout";
import { publicSitePaths } from "../features/publicSite/siteContent";

type ConsumeAccessResponse = {
  authenticated: boolean;
  redirectPath: string;
};

export const CustomerAccountAccessPage = () => {
  const { token } = useParams();
  const [error, setError] = useState<string | null>(null);
  const consumeStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const consume = async () => {
      if (consumeStartedRef.current) {
        return;
      }
      consumeStartedRef.current = true;

      if (!token) {
        setError("Customer access link is missing.");
        return;
      }

      try {
        const payload = await apiPost<ConsumeAccessResponse>("/api/customer-auth/consume", {
          token,
        });
        if (!cancelled) {
          window.location.replace(payload.redirectPath || publicSitePaths.account);
        }
      } catch (consumeError) {
        if (!cancelled) {
          setError(
            consumeError instanceof Error
              ? consumeError.message
              : "Could not complete customer sign-in.",
          );
        }
      }
    };

    void consume();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <PublicSiteLayout currentNav="repairs">
      <div className="customer-booking-shell">
        <section className="customer-booking-card customer-account-card customer-account-access-card">
          <div className="customer-booking-hero">
            <div>
              <p className="customer-booking-kicker">Customer account</p>
              <h1>Opening your secure workshop account</h1>
              <p className="customer-booking-intro">
                The sign-in link is being checked now. If it is still valid, you will be taken straight into
                your customer account.
              </p>
            </div>
          </div>

          {error ? (
            <div className="customer-account-inline-banner customer-account-inline-banner--error">
              <strong>That sign-in link could not be used.</strong>
              <p>{error}</p>
              <Link className="button-link" to={publicSitePaths.accountLogin}>
                Request a new sign-in link
              </Link>
            </div>
          ) : (
            <div className="customer-account-inline-banner">
              <strong>Checking the secure link...</strong>
              <p>This usually takes a moment.</p>
            </div>
          )}
        </section>
      </div>
    </PublicSiteLayout>
  );
};
