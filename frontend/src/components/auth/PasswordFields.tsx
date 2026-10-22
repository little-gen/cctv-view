import { Check, Circle } from 'lucide-react';

/** Debe coincidir con la política del servidor (backend/src/lib/password.ts). */
export const PASSWORD_MIN = 12;

export function passwordProblems(password: string, confirm: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`al menos ${PASSWORD_MIN} caracteres`);
  if (new Set(password).size < 5) problems.push('no demasiado repetitiva');
  if (confirm !== password) problems.push('las dos contraseñas coinciden');
  return problems;
}

/** Nueva contraseña + confirmación, con las reglas a la vista. */
export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const rules = [
    { ok: password.length >= PASSWORD_MIN, text: `Al menos ${PASSWORD_MIN} caracteres (mejor una frase)` },
    { ok: password.length > 0 && confirm === password, text: 'Las dos contraseñas coinciden' },
  ];
  return (
    <>
      <div>
        <label className="label" htmlFor="new-password">Nueva contraseña</label>
        <input id="new-password" className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => onPassword(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="confirm-password">Repite la nueva contraseña</label>
        <input id="confirm-password" className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </div>
      <ul className="space-y-1 text-xs" aria-label="Requisitos de la contraseña">
        {rules.map((r) => (
          <li key={r.text} className={`flex items-center gap-1.5 ${r.ok ? 'text-ink-2' : 'text-muted'}`}>
            {r.ok ? <Check className="size-3.5 text-ok" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
            {r.text}
          </li>
        ))}
      </ul>
    </>
  );
}
