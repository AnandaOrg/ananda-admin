import { NotFound } from '@/components/ui';
import css from './not-found.module.css';

export default function NotFoundPage() {
  return (
    <main className={`auth-wrap ${css.page}`}>
      <NotFound />
    </main>
  );
}
