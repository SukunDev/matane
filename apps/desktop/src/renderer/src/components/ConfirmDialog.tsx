import { AlertDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

/** Asks before a destructive action; `onConfirm` runs when the user agrees. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border bg-popover p-5 shadow-2xl">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-muted-foreground">{description}</AlertDialog.Description>
          <div className="mt-2 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">{t('common.cancel')}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant={destructive ? 'destructive' : 'default'}
                className={destructive ? 'bg-destructive/10' : undefined}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
