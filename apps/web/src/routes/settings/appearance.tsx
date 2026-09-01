import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles, Type } from 'lucide-react'
import { toast } from 'sonner'
import { companyTheme, type ThemeFontKey } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { DEFAULT_PRESET_KEY, THEME_PRESETS, presetFor, type ThemePreset } from '@/shared/theme/presets'
import { FONT_OPTIONS, FONT_KEYS, fontOr, fontStack, loadFont } from '@/shared/theme/fonts'
import { Button } from '@/shared/ui/button'
import { TiltCard } from '@/shared/ui/tilt-card'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'

import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'

const PANGRAM = 'The quick brown fox jumps over the lazy dog.'

export function AppearancePage() {
  return (
    <AuthedPage module="settings">
      <Appearance />
    </AuthedPage>
  )
}

function Appearance() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const { applyTheme, scheme } = useTheme()
  const isOwner = session?.is_owner ?? false

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: () => callApi('/settings/theme', { responseSchema: companyTheme }),
  })

  const save = useMutation({
    mutationFn: (body: { preset_key: string; font_key: string | null }) =>
      callApi('/settings/theme', {
        method: 'PATCH',
        body: { ...body, color_scheme: data?.color_scheme ?? 'light' },
        responseSchema: companyTheme,
      }),
    onSuccess: (saved) => {
      applyTheme(saved.preset_key, saved.font_key)
      setPreview(null)
      toast.success(`${presetFor(saved.preset_key).label} applied`)
      void qc.invalidateQueries({ queryKey: ['settings', 'theme'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /** An unsaved look being tried on. Null means "showing what's saved". */
  const [preview, setPreview] = useState<{ preset: string; font: string | null } | null>(null)
  const [fontFor, setFontFor] = useState<ThemePreset | null>(null)

  const savedPreset = data ? presetFor(data.preset_key).key : DEFAULT_PRESET_KEY
  const savedFont = data?.font_key ?? null

  // Every sample renders in its own face, so the gallery loads them all up
  // front — a card whose sample is still in the fallback stack is telling the
  // studio something untrue about what they're picking.
  useEffect(() => {
    for (const key of FONT_KEYS) loadFont(FONT_OPTIONS[key])
  }, [])

  // Paint whatever is saved when the page opens, and again whenever a preview
  // is dropped.
  useEffect(() => {
    if (!data || preview) return
    applyTheme(data.preset_key, data.font_key)
  }, [data, preview, applyTheme])

  function startPreview(preset: ThemePreset, font: string | null = null) {
    setPreview({ preset: preset.key, font })
    applyTheme(preset.key, font)
  }

  function cancelPreview() {
    setPreview(null)
    applyTheme(savedPreset, savedFont)
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="Theme & Branding" description="How your studio's dashboard looks." />
        <SettingsTabs />
        <SkeletonCards count={3} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Theme & Branding"
        description="Pick the palette and typeface your whole studio sees."
      />
      <SettingsTabs />

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          Each theme includes a matching font. You can apply the theme directly, or use{' '}
          <span className="font-medium text-foreground">Customize Font</span> to change typography
          before saving.
          {!isOwner && ' Only the studio owner can change this.'}
        </p>
      </div>

      {preview && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="flex-1 text-sm">
            Previewing <span className="font-medium">{presetFor(preview.preset).label}</span>
            {preview.font && ` with ${fontOr(preview.font, 'inter').family}`}. Nothing is saved yet.
          </p>
          <Button variant="outline" onClick={cancelPreview}>
            Cancel
          </Button>
          <Button
            disabled={!isOwner || save.isPending}
            onClick={() => save.mutate({ preset_key: preview.preset, font_key: preview.font })}
          >
            {save.isPending ? 'Saving…' : 'Save this theme'}
          </Button>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.values(THEME_PRESETS).map((p) => (
          <ThemeCard
            key={p.key}
            preset={p}
            scheme={scheme}
            applied={p.key === savedPreset}
            appliedFont={p.key === savedPreset ? savedFont : null}
            canEdit={isOwner}
            busy={save.isPending}
            previewing={preview?.preset === p.key}
            onPreview={() => startPreview(p)}
            onApply={() => save.mutate({ preset_key: p.key, font_key: null })}
            onCustomizeFont={() => setFontFor(p)}
          />
        ))}
      </div>

      {fontFor && (
        <FontDialog
          preset={fontFor}
          current={fontFor.key === savedPreset ? savedFont : null}
          canEdit={isOwner}
          busy={save.isPending}
          onClose={() => setFontFor(null)}
          onPreview={(font) => startPreview(fontFor, font)}
          onSave={(font) =>
            save.mutate(
              { preset_key: fontFor.key, font_key: font },
              { onSuccess: () => setFontFor(null) },
            )
          }
        />
      )}
    </>
  )
}

function ThemeCard({
  preset,
  scheme,
  applied,
  appliedFont,
  canEdit,
  busy,
  previewing,
  onPreview,
  onApply,
  onCustomizeFont,
}: {
  preset: ThemePreset
  scheme: 'light' | 'dark'
  applied: boolean
  appliedFont: string | null
  canEdit: boolean
  busy: boolean
  previewing: boolean
  onPreview: () => void
  onApply: () => void
  onCustomizeFont: () => void
}) {
  // The card shows the face this theme would actually give you: its own,
  // unless this is the applied theme and the studio has overridden it.
  const font = fontOr(appliedFont, preset.font)
  const tokens = preset[scheme]

  return (
    // A theme swatch is a showcase object, not something you read a row out
    // of, so it is one of the few places a tilt belongs.
    <TiltCard className="flex">
      <Card
        className={cn(
          'flex flex-1 flex-col',
          applied && 'border-primary ring-1 ring-primary/30',
        )}
      >
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold tracking-tight">{preset.label}</h3>
          {applied && (
            <StatusBadge tone="info" className="gap-1">
              <Check className="size-3" /> Active
            </StatusBadge>
          )}
          {previewing && !applied && <StatusBadge tone="warning">Previewing</StatusBadge>}
        </div>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{preset.description}</p>

        <Swatches tokens={tokens} />

        <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Font
            </span>
            <span className="truncate text-xs text-muted-foreground">{font.hint}</span>
          </div>
          <p className="mt-1 text-lg font-semibold" style={{ fontFamily: fontStack(font) }}>
            {font.family}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground" style={{ fontFamily: fontStack(font) }}>
            {PANGRAM}
          </p>
          <button
            type="button"
            onClick={onCustomizeFont}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <Type className="size-3.5" /> Customize Font →
          </button>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
          <Button variant="outline" onClick={onPreview}>
            Preview
          </Button>
          <Button onClick={onApply} disabled={!canEdit || applied || busy}>
            {applied ? 'Applied' : 'Apply Theme'}
          </Button>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Font can be changed anytime from Customize → Typography.
        </p>
      </CardContent>
      </Card>
    </TiltCard>
  )
}

/**
 * The palette, drawn from the tokens the theme actually writes — so a swatch
 * can never promise a colour the interface won't use.
 */
function Swatches({ tokens }: { tokens: Record<string, string> }) {
  const chips: Array<[string, string]> = [
    ['Accent', tokens['--primary']!],
    ['Brand', tokens['--brand']!],
    ['Tint', tokens['--accent']!],
    ['On accent', tokens['--primary-foreground']!],
    ['Ink', tokens['--accent-foreground']!],
  ]
  return (
    <div className="mt-3 flex gap-1.5">
      {chips.map(([label, value]) => (
        <span
          key={label}
          title={`${label} — ${value}`}
          className="h-7 flex-1 rounded-full border border-border"
          style={{ backgroundColor: value }}
        />
      ))}
    </div>
  )
}

function FontDialog({
  preset,
  current,
  canEdit,
  busy,
  onClose,
  onPreview,
  onSave,
}: {
  preset: ThemePreset
  current: string | null
  canEdit: boolean
  busy: boolean
  onClose: () => void
  onPreview: (font: string | null) => void
  onSave: (font: string | null) => void
}) {
  const [selected, setSelected] = useState<ThemeFontKey>(
    (current as ThemeFontKey | null) ?? preset.font,
  )
  const matchesTheme = selected === preset.font

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Typography for ${preset.label}`}
        description="Preview a face on the whole dashboard before you commit to it."
        className="max-w-xl"
      >
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {FONT_KEYS.map((key) => {
            const font = FONT_OPTIONS[key]
            const on = selected === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSelected(key)
                  onPreview(key === preset.font ? null : key)
                }}
                className={cn(
                  'flex w-full flex-col rounded-lg border p-3 text-left transition-colors',
                  on ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:bg-accent',
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium" style={{ fontFamily: fontStack(font) }}>
                    {font.family}
                    {key === preset.font && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        theme default
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{font.hint}</span>
                </span>
                <span
                  className="mt-1 text-sm text-muted-foreground"
                  style={{ fontFamily: fontStack(font) }}
                >
                  {PANGRAM}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={!canEdit || busy}
            onClick={() => onSave(matchesTheme ? null : selected)}
          >
            {busy ? 'Saving…' : 'Apply theme & font'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
