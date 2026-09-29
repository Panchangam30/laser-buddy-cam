import "./SiteFooter.css";

const LIVE_SITE = "https://laserbuddy.vercel.app/";

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? "site-footer compact" : "site-footer"}>
      <div className="site-footer-project">
        {/* No arrow glyph appended to the label: the link opens in a new tab,
            which target and rel already say, and the credits below are the
            quiet part of the panel rather than a second call to action. */}
        <a className="site-footer-live" href={LIVE_SITE} target="_blank" rel="noreferrer"
          aria-label="View Laser Buddy live">
          <span className="site-footer-live-dot" />
          Laser Buddy live
        </a>
        <span className="site-footer-url">laserbuddy.vercel.app</span>
      </div>
      <div className="site-footer-meta">
        <span>Built by Sriman Panchangam, Shivang Patel, Advait Chandrakar, and Abhinav Ramireddy</span>
        <nav aria-label="Legal"><a href="/docs#privacy">Privacy</a><a href="/docs#terms">Terms</a></nav>
      </div>
    </footer>
  );
}
