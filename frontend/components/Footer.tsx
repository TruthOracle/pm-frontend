import { Link } from "react-router-dom";
import { Globe2, Mail, MessageCircle } from "lucide-react";
import { currentUTCYear } from "@/lib/time";

const Footer = () => (
  <footer className="site-footer">
    <div className="page-container py-14 sm:py-16">
      <div className="mb-12 flex flex-wrap items-start justify-between gap-8">
        <div><Link to="/" className="text-lg font-extrabold tracking-[-0.04em] text-slate-950">Truth<span className="text-primary">Oracle</span></Link><p className="mt-2 text-sm text-slate-500">The transparent prediction market.</p></div>
        <div className="footer-socials"><a href="mailto:hello@truthoracle.xyz" aria-label="Email"><Mail className="h-4 w-4" /></a><a href="/faq" aria-label="Community"><MessageCircle className="h-4 w-4" /></a><span aria-label="Language"><Globe2 className="h-4 w-4" /> English <span className="text-slate-400">⌄</span></span></div>
      </div>
      <div className="grid gap-10 sm:grid-cols-[1.6fr_1fr_1fr]">
        <div><p className="footer-label">Markets by category</p><div className="footer-topic-grid"><Link to="/marketplace?category=politics" className="footer-link">Politics <small>Predictions & odds</small></Link><Link to="/marketplace?category=sports" className="footer-link">Sports <small>Predictions & odds</small></Link><Link to="/marketplace?category=crypto" className="footer-link">Crypto <small>Predictions & odds</small></Link><Link to="/marketplace?category=business" className="footer-link">Business <small>Predictions & odds</small></Link><Link to="/marketplace?category=world" className="footer-link">World <small>Predictions & odds</small></Link><Link to="/marketplace" className="footer-link">All markets <small>Browse the signal</small></Link></div></div>
        <div><p className="footer-label">Support & learn</p><Link to="/faq" className="footer-link">How it works</Link><Link to="/faq" className="footer-link">Help center</Link><Link to="/faq" className="footer-link">Market integrity</Link><span className="footer-link">Contact us</span></div>
        <div><p className="footer-label">TruthOracle</p><Link to="/rewards" className="footer-link">Rewards</Link><Link to="/portfolio" className="footer-link">Portfolio</Link><span className="footer-link">Built on Canton</span><span className="footer-link">Careers</span></div>
      </div>
    </div>
    <div className="page-container border-t border-slate-200/80 py-4 text-xs text-slate-400"><span>TruthOracle © {currentUTCYear()}</span><span className="mx-2">·</span><span>Privacy</span><span className="mx-2">·</span><span>Terms of Use</span><span className="mx-2">·</span><span>Market outcomes are not financial advice.</span></div>
  </footer>
);

export default Footer;
