'use client';

/** Theme preference: System / Light / Dark (profile menu), kept in a cookie so the first paint is right. */
export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_COOKIE = 'ananda_theme';

export function readThemePref(): ThemePref {
  if (typeof document === 'undefined') return 'dark';
  const m = document.cookie.match(/(?:^|;\s*)ananda_theme=(system|light|dark)/);
  return (m?.[1] as ThemePref) ?? 'dark';
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return pref;
}

/** Applies the preference now (html[data-theme]) and remembers it in this browser. */
export function applyThemePref(pref: ThemePref) {
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
  const el = document.documentElement;
  el.setAttribute('data-theme', resolveTheme(pref));
  el.setAttribute('data-theme-pref', pref);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolveTheme(pref) === 'light' ? '#F8F8F8' : '#0A0A0B');
}

/** Inline script for <head>: resolves "system" before the first paint and follows the OS while open. */
export const THEME_BOOT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)ananda_theme=(system|light|dark)/);var p=m?m[1]:'dark';var q=window.matchMedia('(prefers-color-scheme: light)');var r=function(){var t=p==='system'?(q.matches?'light':'dark'):p;document.documentElement.setAttribute('data-theme',t);};r();q.addEventListener&&q.addEventListener('change',function(){var mm=document.cookie.match(/(?:^|;\\s*)ananda_theme=(system|light|dark)/);p=mm?mm[1]:'dark';r();});}catch(e){}})();`;
