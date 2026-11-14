import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main className="auth-wrap">
      <div className="an-noaccess" style={{ marginTop: 0 }}>
        <h3>We can&apos;t find this page</h3>
        <p>It may have been deleted, or the link is out of date.</p>
        <Link href="/home" className="an-btn secondary">
          Back to Overview
        </Link>
      </div>
    </main>
  );
}
