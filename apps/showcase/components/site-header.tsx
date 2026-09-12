import Link from "next/link";

const navigation = [
  ["Overview", "/"],
  ["Demo", "/demo"],
  ["Evidence", "/demo/evidence"],
  ["Packet", "/demo/application-packet"],
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/" aria-label="ApplyPilot public showcase home">
        <span aria-hidden="true">AP</span>
        <strong>ApplyPilot</strong>
      </Link>
      <nav aria-label="Showcase navigation">
        {navigation.map(([label, href]) => (
          <Link href={href} key={href}>
            {label}
          </Link>
        ))}
      </nav>
      <a
        className="header-github"
        href="https://github.com/adeel1608/applypilot"
        target="_blank"
        rel="noreferrer"
      >
        GitHub <span aria-hidden="true">↗</span>
      </a>
    </header>
  );
}
