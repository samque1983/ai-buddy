'use client';

import { PACK_OPTIONS, normalizeActivePacks } from '@/lib/learning/content-packs';

/**
 * Single-select content picker shared by Settings and Home. One of the content packs
 * (日常/雅思) or 自由畅聊 (a mode). Legacy multi-pack values are normalized for display.
 * Pure display + callback; the caller owns persistence.
 */
export function ContentPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[] | null | undefined;
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const active = normalizeActivePacks(value)[0];

  return (
    <div className="space-y-2">
      {PACK_OPTIONS.map((opt) => {
        const selected = active === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!selected) onChange([opt.id]);
            }}
            className={`w-full rounded-xl border px-4 py-3 text-left transition disabled:opacity-50 ${
              selected
                ? 'border-foreground bg-foreground text-background'
                : 'border-black/15 dark:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{opt.label}</span>
              <span className="text-sm">{selected ? '✓ 进行中' : '未启用'}</span>
            </div>
            <div className="mt-0.5 text-sm opacity-70">{opt.desc}</div>
            {opt.kind === 'mode' && (
              <div className="mt-0.5 text-xs opacity-50">与词库互斥,选它就不刷词</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
