import { Palette, Check } from 'lucide-react';
import { THEMES } from '../../config/themes';
import { useTheme } from '../../context/ThemeContext';
import { Dropdown } from '../ui/Dropdown';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const active = THEMES.find((t) => t.id === theme);

  return (
    <Dropdown
      trigger={({ toggle }) => (
        <button
          onClick={toggle}
          aria-label="Switch theme"
          className="flex items-center gap-2 rounded-xl border border-edge bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-edge-strong"
        >
          {active ? <active.icon size={16} className="text-accent" /> : <Palette size={16} />}
          <span className="hidden sm:inline">{active?.name ?? 'Theme'}</span>
        </button>
      )}
    >
      {({ close }) => (
        <div className="w-60">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTheme(t.id);
                close();
              }}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
            >
              <t.icon size={16} className="shrink-0 text-ink-muted" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink">{t.name}</span>
                <span className="block text-xs text-ink-muted">{t.description}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {t.swatch.map((c) => (
                  <span
                    key={c}
                    className="h-3 w-3 rounded-full border border-black/10"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              {theme === t.id && <Check size={15} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
