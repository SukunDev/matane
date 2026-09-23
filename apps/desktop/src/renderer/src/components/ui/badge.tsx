import { type VariantProps, cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-input bg-muted text-foreground',
        outline: 'text-muted-foreground',
        primary: 'border-primary/40 bg-primary/15 text-primary',
        success: 'border-ctp-green/40 bg-ctp-green/10 text-ctp-green',
        warning: 'border-ctp-peach/40 bg-ctp-peach/10 text-ctp-peach',
        danger: 'border-ctp-red/40 bg-ctp-red/10 text-ctp-red',
        info: 'border-ctp-blue/40 bg-ctp-blue/10 text-ctp-blue',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
