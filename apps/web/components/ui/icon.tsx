'use client';

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

// Phosphor Regular only (design system: Iconography).
export {
  ArrowClockwise,
  ArrowLeft,
  ArrowCounterClockwise,
  ArrowUpRight,
  Bank,
  Bell,
  Briefcase,
  CalendarBlank,
  CalendarDots,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartLine,
  ChartLineUp,
  Check,
  CheckCircle,
  Clock,
  ClockCounterClockwise,
  Coins,
  Columns,
  DotsThreeOutline,
  DownloadSimple,
  EnvelopeOpen,
  EnvelopeSimple,
  GoogleLogo,
  LinkBreak,
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
  Moon,
  NotePencil,
  Package,
  Phone,
  PiggyBank,
  Plus,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  ShoppingCartSimple,
  SidebarSimple,
  Signature,
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
  WifiSlash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

const FLIP = new Set(['CaretLeft', 'CaretRight', 'ArrowUpRight', 'ArrowCounterClockwise', 'SignOut', 'ArrowLeft']);

/**
 * True for direction icons (forward / back), which mirror in Hebrew. Phosphor names its components
 * "CaretRightIcon", so the "Icon" suffix is dropped before the lookup.
 */
export const isDirectional = (C: PhosphorIcon) => FLIP.has(((C as { displayName?: string }).displayName ?? '').replace(/Icon$/, ''));

/** Sized Phosphor icon in currentColor. Direction icons mirror in Hebrew. */
export function Icon({ as: C, size = 'md', className = '', label }: { as: PhosphorIcon; size?: 'sm' | 'md' | 'lg'; className?: string; label?: string }) {
  const flip = isDirectional(C);
  return (
    <C
      className={`an-ic ${size === 'md' ? '' : size} ${flip ? 'flip' : ''} ${className}`.trim()}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      weight="regular"
    />
  );
}
