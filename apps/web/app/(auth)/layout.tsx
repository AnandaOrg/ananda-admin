export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="auth-card stack loose">
        <div className="an-brand" style={{ padding: 0 }}>
          <span className="mk">A</span>
          <span>
            <b>ANANDA</b>
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}
