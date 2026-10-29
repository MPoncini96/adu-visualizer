"use client";
// Site-wide top bar: brand, the two tools, and a quote button. Collapses to a menu on phones.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const QuoteModal = dynamic(() => import("./QuoteModal.jsx"), { ssr: false });

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/walk", label: "Walk inside" },
  { href: "/visualizer", label: "3D Visualizer" },
];

export function Logo({ size = 30 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M4 16 16 6l12 10v11H4z" fill="#2f6b4f" />
      <path d="M11 27v-7h10v7" fill="#f6f3ec" />
      <path d="M2 16.5 16 5l14 11.5" stroke="#c4683a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function SiteNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState(false);
  useEffect(() => setOpen(false), [path]);

  return (
    <header className={`site-nav ${open ? "open" : ""}`}>
      <Link href="/" className="site-brand" aria-label="Valley ADU Studio home">
        <Logo />
        <span>
          <span className="site-brand-name">Valley ADU Studio</span>
          <span className="site-brand-tag">Lodi to Fresno · along Highway 99</span>
        </span>
      </Link>
      <button className="site-menu-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="site-links" aria-label="Menu">
        <span /><span /><span />
      </button>
      <nav id="site-links" className="site-links" aria-label="Main">
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={path === l.href ? "on" : ""} aria-current={path === l.href ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
        <button className="btn btn-primary btn-sm site-quote" onClick={() => { setOpen(false); setQuote(true); }}>Get a quote</button>
      </nav>
      {quote && (
        <QuoteModal
          onClose={() => setQuote(false)}
          summary={{ model: "No plan chosen yet", style: "", address: "", placement: "", clearance: "", backLabel: "Close", sendLabel: "Send" }}
        />
      )}
    </header>
  );
}
