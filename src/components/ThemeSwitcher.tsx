import { useState } from 'react';
import { ChevronDown, ChevronUp, Palette } from 'lucide-react';
import { getThemeTokens, THEME_LIST, type AppTheme } from '../lib/themes';

interface ThemeSwitcherProps {
  theme: AppTheme;
  label?: string;
  onChangeTheme: (theme: AppTheme) => void;
}

export function ThemeSwitcher({
  theme,
  label = '活動風格主題（進入即自動套用）',
  onChangeTheme,
}: ThemeSwitcherProps) {
  const [expanded, setExpanded] = useState(false);
  const current = getThemeTokens(theme);

  const worldThemes = THEME_LIST.filter((t) => t.group === 'world');
  const festivalThemes = THEME_LIST.filter((t) => t.group === 'festival');

  return (
    <div className="rpg-theme-switcher px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Palette className="h-3.5 w-3.5 shrink-0 opacity-85" />
          <span className="truncate font-semibold opacity-90">{label}</span>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rpg-theme-pill-active inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:opacity-90"
        >
          <span>{current.emoji}</span>
          <span>{current.name}</span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {expanded ? (
        <div className="mt-2.5 space-y-3 border-t border-slate-200 pt-2.5">
          <div>
            <p className="mb-1.5 text-[10px] font-bold opacity-70">
              風格世界（{worldThemes.length}）
            </p>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {worldThemes.map((opt) => {
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onChangeTheme(opt.id);
                      setExpanded(false);
                    }}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold transition ${
                      active ? 'rpg-theme-pill-active' : 'rpg-theme-pill-idle'
                    }`}
                  >
                    <span className="shrink-0">{opt.emoji}</span>
                    <span className="truncate">{opt.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-bold opacity-70">
              節日慶典（{festivalThemes.length}）
            </p>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {festivalThemes.map((opt) => {
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onChangeTheme(opt.id);
                      setExpanded(false);
                    }}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold transition ${
                      active ? 'rpg-theme-pill-active' : 'rpg-theme-pill-idle'
                    }`}
                  >
                    <span className="shrink-0">{opt.emoji}</span>
                    <span className="truncate">{opt.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
