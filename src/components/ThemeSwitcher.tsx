import { Palette } from 'lucide-react';
import type { AppTheme } from '../types/party';

interface ThemeSwitcherProps {
  theme: AppTheme;
  onChangeTheme: (theme: AppTheme) => void;
}

const THEME_OPTIONS: { id: AppTheme; label: string; dot: string }[] = [
  { id: 'tavern', label: '16-bit 酒館', dot: 'bg-[#8C5633]' },
  { id: 'cozy', label: '清新像素', dot: 'bg-[#4E8C65]' },
  { id: 'jrpg', label: '經典 JRPG', dot: 'bg-[#1D3591]' },
];

export function ThemeSwitcher({ theme, onChangeTheme }: ThemeSwitcherProps) {
  return (
    <div className="rpg-theme-switcher flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold opacity-90">
        <Palette className="h-3.5 w-3.5" />
        全站風格主題（即時同步所有人）
      </span>
      <div className="flex flex-wrap gap-1.5">
        {THEME_OPTIONS.map((opt) => {
          const active = theme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeTheme(opt.id)}
              className={`rpg-theme-pill inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                active ? 'rpg-theme-pill-active' : 'rpg-theme-pill-idle'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ring-1 ring-black/25 ${opt.dot}`} />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
