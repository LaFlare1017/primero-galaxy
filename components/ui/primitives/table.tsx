import * as React from 'react';

import { cn } from '@/lib/utils';

/** shadcn/ui table family, ported from the Circle extraction. */
function Table({ className, ...props }: React.ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="relative w-full overflow-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentPropsWithoutRef<'thead'>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-border', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentPropsWithoutRef<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentPropsWithoutRef<'tr'>) {
  return (
    <tr
      className={cn('border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted', className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      className={cn('h-10 px-3 text-left align-middle font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentPropsWithoutRef<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
