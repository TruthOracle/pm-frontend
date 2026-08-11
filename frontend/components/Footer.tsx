import { ArrowUpRight, Github, Mail, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="site-footer">
      <div className="page-container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-950">
              <span className="footer-mark">TO</span> Truth<span className="text-primary">Oracle</span>
            </Link>
            <p>Markets for what happens next. Transparent, on-chain and built for informed conviction.</p>
            <div className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-primary" /> Powered by Canton Network</div>
          </div>
          <div><p className="footer-label">Explore</p><Link to="/marketplace">All markets <ArrowUpRight /></Link><Link to="/portfolio">Portfolio <ArrowUpRight /></Link><Link to="/rewards">Rewards <ArrowUpRight /></Link></div>
          <div><p className="footer-label">Learn</p><Link to="/faq">How it works</Link><Link to="/news">Market news</Link><a href="mailto:hello@truthoracle.market">Contact us</a></div>
          <div><p className="footer-label">Stay close</p><p className="text-sm leading-6 text-slate-500">Get the signal before the crowd.</p><div className="mt-4 flex gap-2"><a className="footer-icon" href="mailto:hello@truthoracle.market" aria-label="Email"><Mail /></a><a className="footer-icon" href="https://github.com" aria-label="Github"><Github /></a></div></div>
        </div>
        <div className="footer-bottom"><span>© 2026 TruthOracle. Enter at your own risk.</span><span>Privacy · Terms · Market integrity</span></div>
      </div>
    </footer>
  );
};

export default Footer;
