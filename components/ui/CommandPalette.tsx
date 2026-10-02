'use client';

import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  Command as CommandIcon,
  FileText,
  Galaxy,
  Map as MapIcon,
  Monitor,
  Orbit,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/primitives/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/primitives/command';
import {
  PALETTE_SURFACE_ROWS,
  TOGGLE_PALETTE_KEYS,
  layerIsLive,
  liveShortcuts,
  matchesModifiedKey,
  paletteGates,
  type PaletteRoute,
} from '@/components/ui/commandPaletteKeys';
import { cn } from '@/lib/utils';

/**
 * ⌘K command palette (Circle-style, cmdk): app navigation, every published
 * FinBench task, and Delegate scenario deep links. Mounted once in the root
 * layout so the shortcut works on every product surface.
 *
 * Its keyboard is DECLARED in ./commandPaletteKeys and read from there: the
 * toggle's chord is matched as the declaration spells it, the two ways back out
 * of a sub-list are mounted from the same rows that decide what the dialog
 * advertises in `aria-keyshortcuts`, and e2e/command-palette.spec.ts runs the
 * shared coherence checks (e2e/keyboard-coherence.ts) over the declaration in
 * node.
 */

import asc606 from '@/public/finbench/asc606.json';
import govcon from '@/public/finbench/govcon.json';

type TaskStub = { id: string; category: string; difficulty: string };

const TASKS: TaskStub[] = [
  ...(asc606 as { tasks: TaskStub[] }).tasks,
  ...(govcon as { tasks: TaskStub[] }).tasks,
];

const SCENARIOS: { id: string; n: number; title: string }[] = [
  { id: 's1', n: 1, title: 'Reconcile the March operating bank account' },
  { id: 's2', n: 2, title: "Why doesn't intercompany balance?" },
  { id: 's3', n: 3, title: 'Draft Q1 flux commentary' },
  { id: 's4', n: 4, title: 'AR aging report by entity' },
  { id: 's5', n: 5, title: 'Revenue recognition: Meridian Labs contract' },
  { id: 's6', n: 6, title: 'Post the March accruals' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [route, setRoute] = useState<PaletteRoute>('root');
  // cmdk owns the query. The palette needs one fact about it and no more —
  // whether there is one — because that is what decides whether Backspace
  // deletes a character or leaves the list (`backspace-to-root`).
  const [inputEmpty, setInputEmpty] = useState(true);

  const router = useRouter();
  const pathname = usePathname();
  const isDelegate = pathname?.startsWith('/delegate') ?? false;

  const gates = paletteGates({ open, route, inputEmpty });

  const reset = useCallback(() => {
    setRoute('root');
    setInputEmpty(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  // ⌘K / Ctrl+K toggles, mirroring Circle's palette binding. The chord is the
  // declaration's own spelling rather than a second one typed here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesModifiedKey(TOGGLE_PALETTE_KEYS, event)) return;
      event.preventDefault();
      setOpen((value) => {
        if (value) reset();
        return !value;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reset]);

  const go = (path: string) => {
    router.push(path);
    close();
  };

  const goScenario = (scenarioId: string) => {
    if (pathname === '/delegate') {
      // Same-page selection: the page is already mounted, so a query-only
      // push would not remount it. Tell it directly.
      window.dispatchEvent(
        new CustomEvent('delegate:select-scenario', { detail: scenarioId }),
      );
    } else {
      router.push(`/delegate?scenario=${scenarioId}`);
    }
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogContent
        hideClose
        className="overflow-hidden p-0 sm:max-w-xl"
        aria-keyshortcuts={liveShortcuts(PALETTE_SURFACE_ROWS.dialog, gates) || undefined}
        // Escape belongs to the topmost thing the palette opened, and the
        // dismissal Radix installs is the layer underneath. Radix listens in
        // the CAPTURE phase, so the back-out has to be decided HERE — a
        // handler on the input, whose event bubbles, can never beat it. That
        // is also the layering the declaration states (`close-palette` lives
        // under `subroute`), which is what lets the harness prove the two
        // Escape bindings are never live at once.
        onEscapeKeyDown={(event) => {
          if (!layerIsLive('back-to-root', gates)) return;
          event.preventDefault();
          reset();
        }}
        onKeyDown={(event) => {
          // Backspace leaves the list only when there is nothing for the caret
          // to delete — the same gate the dialog advertises, so the key and the
          // claim about it cannot disagree.
          if (event.key !== 'Backspace') return;
          if (!layerIsLive('backspace-to-root', gates)) return;
          event.preventDefault();
          reset();
        }}
      >
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <DialogDescription className="sr-only">Type a command or search</DialogDescription>
        <Command
          loop
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <CommandInput
            placeholder="Type a command or search…"
            // cmdk keeps the query; this is the only fact the keyboard needs
            // about it. Setting the same boolean again is a no-op, so only the
            // two transitions — first character, and back to empty — re-render.
            onValueChange={(value) => setInputEmpty(value === '')}
          />
          {/* The toggle, named. The glyph is drawn rather than typed because
              font coverage for ⌘ is not something to bet a shortcut chip on. */}
          <span className="pointer-events-none absolute right-3 top-3.5 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <CommandIcon className="h-3.5 w-3.5" />
            K
          </span>
          <CommandList className="max-h-96">
            <CommandEmpty>No results found.</CommandEmpty>

            {route === 'root' && (
              <>
                <CommandGroup heading="Go to">
                  <CommandItem onSelect={() => go('/')} keywords={['home', 'landing', 'galaxy']}>
                    <Orbit className="text-muted-foreground" /> Galaxy home
                  </CommandItem>
                  <CommandItem onSelect={() => go('/system-map')} keywords={['system', 'map', 'architecture']}>
                    <MapIcon className="text-muted-foreground" /> System map
                  </CommandItem>
                  <CommandItem onSelect={() => go('/finbench')} keywords={['benchmark', 'asc 606', 'govcon']}>
                    <BarChart3 className="text-muted-foreground" /> FinBench dashboard
                  </CommandItem>
                  <CommandItem onSelect={() => go('/finbench/methodology')} keywords={['benchmark', 'rubric', 'scoring']}>
                    <FileText className="text-muted-foreground" /> FinBench methodology
                  </CommandItem>
                  <CommandItem onSelect={() => go('/delegate')} keywords={['workshop', 'agent', 'accountant']}>
                    <ClipboardList className="text-muted-foreground" /> Delegate workshop
                  </CommandItem>
                  <CommandItem onSelect={() => go('/delegate/facilitator')} keywords={['facilitator', 'grid', 'room']}>
                    <Monitor className="text-muted-foreground" /> Facilitator console
                  </CommandItem>
                  <CommandItem onSelect={() => go('/methodology')} keywords={['maturity', 'model', 'method']}>
                    <Galaxy className="text-muted-foreground" /> Galaxy methodology
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="FinBench tasks">
                  <CommandItem
                    onSelect={() => {
                      setRoute('tasks');
                    }}
                  >
                    <FileText className="text-muted-foreground" />
                    Browse all {TASKS.length} tasks…
                    {/* An affordance, not a key claim: nothing binds ArrowRight
                        here (cmdk selects with the vertical arrows and Enter),
                        and the harness exists to keep this file from saying
                        otherwise. */}
                    <ChevronRight aria-hidden className="ml-auto h-4 w-4 text-muted-foreground" />
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="Delegate scenarios">
                  <CommandItem
                    onSelect={() => {
                      setRoute('scenarios');
                    }}
                  >
                    <ClipboardList className="text-muted-foreground" />
                    Pick a scenario…
                    <ChevronRight aria-hidden className="ml-auto h-4 w-4 text-muted-foreground" />
                  </CommandItem>
                </CommandGroup>
              </>
            )}

            {route === 'tasks' && (
              <CommandGroup heading="FinBench tasks">
                {TASKS.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={task.id}
                    keywords={[task.category, task.difficulty, 'task']}
                    onSelect={() => go(`/finbench/tasks/${task.id}`)}
                  >
                    <FileText className="text-muted-foreground" />
                    <span className="font-mono text-[12.5px]">{task.id}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{task.difficulty}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {route === 'scenarios' && (
              <CommandGroup heading="Delegate scenarios">
                {SCENARIOS.map((scenario) => (
                  <CommandItem
                    key={scenario.id}
                    value={`${scenario.n} ${scenario.title}`}
                    keywords={['scenario', 'workshop', 'delegate']}
                    onSelect={() => goScenario(scenario.id)}
                    className={cn(isDelegate && 'font-medium')}
                  >
                    <ClipboardList className="text-muted-foreground" />
                    <span className="text-muted-foreground">{scenario.n}.</span>
                    {scenario.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
