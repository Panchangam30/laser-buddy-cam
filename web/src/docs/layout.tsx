import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, BookOpen, ChevronRight, Menu, Search, X } from "lucide-react";
import "./docs.css";

const NAV = [
  { heading: "Getting started", links: [["Introduction", "introduction"], ["Installation", "installation"], ["First circuit", "first-circuit"]] },
  { heading: "Using the app", links: [["Camera and planning", "camera"], ["3D workspace", "workspace"], ["Live board tracking", "tracking"], ["Voice assistant", "voice"], ["Laser pointer", "laser"]] },
  { heading: "Reference", links: [["Configuration", "configuration"], ["How it works", "architecture"], ["Troubleshooting", "troubleshooting"], ["Safety and limits", "limits"], ["Privacy", "privacy"], ["Terms", "terms"]] },
] as const;

export function DocsLayout({ children }: { children: ReactNode }) {
  const [active, setActive] = useState("introduction");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const links = NAV.flatMap<readonly [string, string]>((group) => group.links);
  const current = links.find(([, id]) => id === active)?.[0] ?? "Introduction";
  const visibleGroups = NAV.map((group) => ({ ...group, links: group.links.filter(([label]) => label.toLowerCase().includes(query.trim().toLowerCase())) }));

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = [...document.querySelectorAll<HTMLElement>(".docs-article section[id]")];
      const visible = sections.filter((section) => section.getBoundingClientRect().top <= 180);
      setActive(visible.at(-1)?.id ?? "introduction");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, []);

  function navigate(id: string) {
    setActive(id);
    setMenuOpen(false);
    setQuery("");
  }

  return (
    <div className="docs-site">
      <a className="docs-skip" href="#docs-main">Skip to content</a>
      <header className="docs-topbar">
        <a className="docs-brand" href="/"><strong>Laser Buddy</strong><em>Docs</em></a>
        <nav aria-label="Documentation utilities">
          <a href="/hub">Learning hub</a>
          <a href="https://github.com/Panchangam30/laser-buddy-cam" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a>
          <a className="docs-workbench-link" href="/">Open workbench <ArrowUpRight size={13} /></a>
        </nav>
      </header>
      <div className="docs-mobile-nav"><button aria-expanded={menuOpen} aria-controls="docs-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={17} /> : <Menu size={17} />}<span>Documentation</span></button><span>{current}</span></div>
      <aside id="docs-navigation" className={`docs-sidebar${menuOpen ? " is-open" : ""}`}>
        <label className="docs-search"><Search size={15} /><input type="search" aria-label="Find a documentation topic" placeholder="Find a topic…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <nav aria-label="Documentation">
          {visibleGroups.map((group) => group.links.length > 0 && (
            <section key={group.heading}>
              <h2>{group.heading}</h2>
              {group.links.map(([label, id]) => <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined} onClick={() => navigate(id)}>{label}</a>)}
            </section>
          ))}
          {!visibleGroups.some((group) => group.links.length) && <p className="docs-no-results">No matching topics.</p>}
        </nav>
        <a className="docs-sidebar-live" href="https://laserbuddy.vercel.app/" target="_blank" rel="noreferrer"><span /> View Laser Buddy live <ArrowUpRight size={14} /></a>
      </aside>
      <main className="docs-content" id="docs-main" tabIndex={-1}>
        <div className="docs-breadcrumb"><BookOpen size={13} /><span>Documentation</span><ChevronRight size={12} /><strong>{current}</strong></div>
        {children}
      </main>
      <aside className="docs-toc" aria-label="On this page">
        <strong>On this page</strong>
        <nav>{links.map(([label, id]) => <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined} onClick={() => navigate(id)}>{label}</a>)}</nav>
        <a className="docs-edit" href="https://github.com/Panchangam30/laser-buddy-cam" target="_blank" rel="noreferrer">View source <ArrowUpRight size={12} /></a>
      </aside>
    </div>
  );
}
