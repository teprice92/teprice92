import { useMemo, useState } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { useMediaLibrary } from './hooks/useMediaLibrary';
import { useLocalStorage } from './hooks/useLocalStorage';
import { Header } from './components/layout/Header';
import { StatsPanel } from './components/layout/StatsPanel';
import { FilterBar } from './components/layout/FilterBar';
import { MediaGrid } from './components/media/MediaGrid';
import { BoardView } from './components/media/BoardView';
import { AddMediaModal } from './components/media/AddMediaModal';

function Dashboard() {
  const { items, ready, addItem, setStatus, removeItem, hasItem } = useMediaLibrary();
  const [typeFilter, setTypeFilter] = useLocalStorage('mediatracker:typeFilter', 'all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [view, setView] = useLocalStorage('mediatracker:view', 'grid');
  const [adding, setAdding] = useState(false);

  const typeScoped = useMemo(
    () => (typeFilter === 'all' ? items : items.filter((it) => it.type === typeFilter)),
    [items, typeFilter],
  );

  const visible = useMemo(
    () =>
      statusFilter === 'all'
        ? typeScoped
        : typeScoped.filter((it) => it.status === statusFilter),
    [typeScoped, statusFilter],
  );

  return (
    <div className="min-h-dvh">
      <Header onAdd={() => setAdding(true)} />

      <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
        <StatsPanel items={items} typeFilter={typeFilter} />

        <FilterBar
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          view={view}
          onView={setView}
        />

        {ready &&
          (view === 'board' ? (
            <BoardView
              items={typeScoped}
              onSetStatus={setStatus}
              onRemove={removeItem}
            />
          ) : (
            <MediaGrid
              items={visible}
              onSetStatus={setStatus}
              onRemove={removeItem}
              onAdd={() => setAdding(true)}
            />
          ))}
      </main>

      {adding && (
        <AddMediaModal
          onClose={() => setAdding(false)}
          onAdd={addItem}
          hasItem={hasItem}
          initialType={typeFilter === 'all' ? 'game' : typeFilter}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>
  );
}
