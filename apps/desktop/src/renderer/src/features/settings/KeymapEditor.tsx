import { MAX_KEYS_PER_ACTION, type ReaderAction } from '@manga-reader/shared/reader';
import { Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { DEFAULT_KEYMAP, READER_ACTIONS, actionForKey, effectiveKeymap, keyId, keyParts } from '../reader/keymap';

type Keymap = Partial<Record<ReaderAction, string[]>>;

const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * Reader keys (mockup 11): every action with its keys, a key added by pressing it, a key taken by
 * another action refused with a message. Only changes from the defaults are stored.
 */
export function KeymapEditor({ keymap, onChange }: { keymap: Keymap; onChange: (keymap: Keymap) => void }) {
  const { t } = useTranslation();
  const keys = effectiveKeymap(keymap);
  const [capturing, setCapturing] = useState<ReaderAction | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const save = (action: ReaderAction, next: readonly string[]) => {
    const changed: Keymap = { ...keymap };
    if (sameKeys(next, DEFAULT_KEYMAP[action])) delete changed[action];
    else changed[action] = [...next];
    onChange(changed);
  };

  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Escape alone cancels (it cannot be added here; "Reset" brings it back for Exit).
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        setCapturing(null);
        setConflict(null);
        return;
      }
      const key = keyId(event);
      if (!key) return;
      const owner = actionForKey(keys, key);
      if (owner && owner !== capturing) {
        setConflict(
          t('settings.reader.keyTaken', {
            key: keyParts(key).join(' '),
            action: t(`settings.reader.actions.${owner}`),
          }),
        );
        return;
      }
      if (!keys[capturing].includes(key)) save(capturing, [...keys[capturing], key].slice(-MAX_KEYS_PER_ACTION));
      setCapturing(null);
      setConflict(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className="flex flex-col">
      {READER_ACTIONS.map((action) => {
        const label = t(`settings.reader.actions.${action}`);
        const active = capturing === action;
        return (
          <div
            key={action}
            data-testid="keymap-row"
            data-action={action}
            className={cn(
              'flex min-h-12 items-center gap-3 border-b py-2 last:border-b-0',
              active && '-mx-2 rounded-lg bg-primary/10 px-2',
            )}
          >
            <span className="flex-1 text-sm">{label}</span>
            <div className="flex flex-wrap justify-end gap-1.5">
              {keys[action].length === 0 && (
                <span className="text-xs text-muted-foreground">{t('settings.reader.noKey')}</span>
              )}
              {keys[action].map((key) => (
                <span
                  key={key}
                  className="group inline-flex h-7 items-center gap-1 rounded-md border bg-ctp-crust/60 px-2 font-mono text-xs"
                >
                  {keyParts(key).join(' ')}
                  <button
                    type="button"
                    aria-label={t('settings.reader.removeKey', { key: keyParts(key).join(' '), action: label })}
                    onClick={() =>
                      save(
                        action,
                        keys[action].filter((k) => k !== key),
                      )
                    }
                    className="text-muted-foreground opacity-60 hover:text-ctp-red group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            {active ? (
              <>
                <span className="inline-flex h-7 items-center rounded-md border-2 border-primary px-2 font-mono text-xs text-primary">
                  {t('settings.reader.pressKey')}
                </span>
                <Button variant="ghost" size="sm" className="text-ctp-red" onClick={() => setCapturing(null)}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('settings.reader.addKey', { action: label })}
                disabled={keys[action].length >= MAX_KEYS_PER_ACTION}
                onClick={() => {
                  setConflict(null);
                  setCapturing(action);
                }}
              >
                <Plus />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('settings.reader.resetKeys', { action: label })}
              className={cn(!keymap[action] && 'invisible')}
              onClick={() => save(action, DEFAULT_KEYMAP[action])}
            >
              <RotateCcw />
            </Button>
          </div>
        );
      })}
      {conflict && (
        <p role="alert" className="mt-3 rounded-lg bg-ctp-red/10 px-3 py-2 text-xs text-ctp-red">
          {conflict}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">{t('settings.reader.keysFooter')}</p>
        <Button variant="secondary" size="sm" disabled={Object.keys(keymap).length === 0} onClick={() => onChange({})}>
          <RotateCcw />
          {t('settings.reader.resetAllKeys')}
        </Button>
      </div>
    </div>
  );
}
