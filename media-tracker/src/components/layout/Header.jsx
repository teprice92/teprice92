import { Plus, LibraryBig } from 'lucide-react';
import { ThemeSwitcher } from '../theme/ThemeSwitcher';

export function Header({ onAdd }) {
  return (
    <header className="glass sticky top-0 z-40 border-b border-edge">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-accent p-2 text-accent-ink">
            <LibraryBig size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-ink">Shelf</h1>
            <p className="hidden text-xs text-ink-muted sm:block">
              Games · Movies · Books
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitcher />
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-accent-ink transition-transform hover:scale-105"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Add media</span>
          </button>
        </div>
      </div>
    </header>
  );
}
