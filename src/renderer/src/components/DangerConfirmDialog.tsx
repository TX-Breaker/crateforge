import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label } from '@/components/ui/misc';
import { useAppState } from '@/lib/appState';
import { t } from '@/lib/i18n';

/**
 * Doppia conferma per azioni distruttive (§3.3): la seconda conferma richiede
 * un gesto esplicito — digitare la parola chiave E spuntare la casella.
 */
export function DangerConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmWord,
  confirmLabel,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmWord: string; // es. "ELIMINA"
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const { locale } = useAppState();
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const armed = typed.trim() === confirmWord && checked;

  const reset = () => {
    setTyped('');
    setChecked(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-2">{description}</div>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="confirm-word">
              {t(locale, 'danger.typeToConfirm')}{' '}
              <span className="font-mono font-bold">{confirmWord}</span>
            </Label>
            <Input
              id="confirm-word"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
            {t(locale, 'danger.understood')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t(locale, 'common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!armed}
            onClick={() => {
              reset();
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
