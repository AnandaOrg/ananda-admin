import css from './auth.module.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="auth-card stack loose">
        <div className={`an-brand ${css.brand}`}>
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
