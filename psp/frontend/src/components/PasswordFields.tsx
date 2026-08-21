'use client';
import { useState } from 'react';
import { Eye, EyeOff, Check, Circle } from 'lucide-react';

// Shared password policy for any create/change-password form. Keep the rules in one place so the
// live checklist and the submit-gate can never drift apart.
const RULES: Array<{ key: string; label: string; test: (p: string) => boolean }> = [
  { key: 'len',    label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'letter', label: 'Contains a letter',     test: (p) => /[a-zA-Z]/.test(p) },
  { key: 'number', label: 'Contains a number',     test: (p) => /[0-9]/.test(p) },
];

/** True when the password satisfies every policy rule. */
export function passwordPolicyOk(pw: string): boolean {
  return RULES.every((r) => r.test(pw));
}

/**
 * Validity gate for a password + confirmation pair.
 * `optional` (e.g. an admin "reset password" left blank = keep current) treats an empty password
 * as valid; a non-empty password must still satisfy the policy and match its confirmation.
 */
export function passwordFieldsValid(pw: string, confirm: string, optional = false): boolean {
  // Optional/blank means "no change" only when BOTH fields are empty; a stray confirmation value
  // must not slip through as valid.
  if (optional && pw.length === 0) return confirm.length === 0;
  return passwordPolicyOk(pw) && pw === confirm;
}

const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]';

export function PasswordFields({
  password, confirm, onPasswordChange, onConfirmChange,
  optional = false, label = 'Password', idPrefix = 'pw',
}: {
  password: string;
  confirm: string;
  onPasswordChange: (v: string) => void;
  onConfirmChange: (v: string) => void;
  /** When true, an empty password is allowed (means "no change") and the checklist stays hidden until typing. */
  optional?: boolean;
  label?: string;
  idPrefix?: string;
}) {
  const [show, setShow] = useState(false);
  const touched = password.length > 0 || confirm.length > 0;
  const showChecklist = optional ? touched : true;
  const matches = password.length > 0 && password === confirm;

  return (
    <div className="space-y-2 @container">
      {/* Password + confirm sit side by side when the container is wide enough, stacked otherwise. */}
      <div className="grid grid-cols-1 @md:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-pw`} className="block text-xs text-gray-500 mb-1">
            {label}{optional && <span className="text-gray-400"> (optional)</span>}
          </label>
          <div className="relative">
            <input
              id={`${idPrefix}-pw`}
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder={optional ? 'Leave blank to keep current' : 'Enter a password'}
              className={`${inputCls} pr-9`}
            />
            <button type="button" onClick={() => setShow((v) => !v)} title={show ? 'Hide' : 'Show'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor={`${idPrefix}-confirm`} className="block text-xs text-gray-500 mb-1">Repeat {label.toLowerCase()}</label>
          <input
            id={`${idPrefix}-confirm`}
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => onConfirmChange(e.target.value)}
            placeholder="Re-enter to confirm"
            className={inputCls}
          />
        </div>
      </div>

      {showChecklist && (
        <ul className="space-y-1 pt-0.5">
          {RULES.map((r) => {
            const ok = r.test(password);
            return (
              <li key={r.key} className={`flex items-center gap-1.5 text-xs ${ok ? 'text-green-600' : 'text-gray-400'}`}>
                {ok ? <Check size={12} /> : <Circle size={12} />} {r.label}
              </li>
            );
          })}
          <li className={`flex items-center gap-1.5 text-xs ${matches ? 'text-green-600' : 'text-gray-400'}`}>
            {matches ? <Check size={12} /> : <Circle size={12} />} Passwords match
          </li>
        </ul>
      )}
    </div>
  );
}
