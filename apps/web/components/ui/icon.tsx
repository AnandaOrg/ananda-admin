'use client';

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

// Phosphor Regular only (design system: Iconography).
export {
  ArrowCounterClockwise,
  ArrowUpRight,
  Bank,
  Briefcase,
  CalendarBlank,
  CalendarDots,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartLineUp,
  Check,
  CheckCircle,
  Clock,
  ClockCounterClockwise,
  DotsThreeOutline,
  DownloadSimple,
  EnvelopeOpen,
  Eye,
  FileText,
  Gear,
  Globe,
  HourglassMedium,
  House,
  Info,
  List,
  Lock,
  MagnifyingGlass,
  MapPin,
  MinusCircle,
  Minus,
  Money,
  NotePencil,
  Package,
  Phone,
  PiggyBank,
  Plus,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  SignOut,
  SlidersHorizontal,
  SquaresFour,
  Sun,
  Tag,
  Tray,
  TrendDown,
  Truck,
  UploadSimple,
  UserPlus,
  Users,
  Warning,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

const FLIP = new Set(['CaretLeft', 'CaretRight', 'ArrowUpRight', 'ArrowCounterClockwise', 'SignOut']);

/** Sized Phosphor icon in currentColor. Direction icons mirror in Hebrew. */
export function Icon({ as: C, size = 'md', className = '', label }: { as: PhosphorIcon; size?: 'sm' | 'md' | 'lg'; className?: string; label?: string }) {
  const flip = FLIP.has((C as { displayName?: string }).displayName ?? '');
  return (
    <C
      className={`an-ic ${size === 'md' ? '' : size} ${flip ? 'flip' : ''} ${className}`.trim()}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      weight="regular"
    />
  );
}
