import { AppWindow, Camera, CircleAlert, Cpu, Flag, FolderOpen, Mic, Monitor, MousePointer2, Pause, Play, RefreshCw, Scan, Square, Volume2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Row } from '@/components/ui/section'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { addMarker, closeRecorder, effectiveAudio, measureSource, refreshSources, startRecording, stopRecording, togglePause, updateSettings, useRecorder, wideGamutDisplay } from '@/capture/recorder'
import { CODEC_NAME, encoderSupport, videoBitrate, type CodecAvailability, type ExportVideoCodec } from '@/engine/encoders'
import { cn } from '@/lib/cn'
import { desktop } from '@/lib/platform'
import { CAPTURE_FPS, CAPTURE_HOTKEYS, CAPTURE_RESOLUTIONS, captureFrame, fitRegion, type CaptureCodec, type CaptureFolderState, type CaptureResolution, type CaptureSource, type Rect } from '@shared/capture'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`)
const two = (n: number) => String(Math.floor(n)).padStart(2, '0')
export const fmtClock = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${two((s % 3600) / 60)}:${two(s % 60)}` : `${two(s / 60)}:${two(s % 60)}`)
/** No microphone, no camera. */
const NONE = 'none'
const QUALITY_LABEL = (q: number) => (q < 30 ? tt('Draft') : q < 60 ? tt('Good') : q < 85 ? tt('High') : tt('Master'))

/** Cameras and microphones, by name. */
function useDevices(open: boolean) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    if (!open) return
    let alive = true
    const load = () =>
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => alive && setDevices(d))
        .catch(() => {})
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', load)
    }
  }, [open])
  // "Default" and "Communications" repeat a real device.
  const real = (kind: MediaDeviceKind) => devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
  return { mics: real('audioinput'), cameras: real('videoinput') }
}

/** How loud a microphone is right now (0..1), while the window is open and nothing is recording. */
function useMicLevel(deviceId: string | null, active: boolean) {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!deviceId || !active) return void setLevel(0)
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let alive = true
    void navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        if (!alive) return void s.getTracks().forEach((t) => t.stop())
        stream = s
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(s).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        timer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf)
          let peak = 0
          for (const v of buf) peak = Math.max(peak, Math.abs(v))
          setLevel(peak)
        }, 70)
      })
      .catch(() => {})
    return () => {
      alive = false
      clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [deviceId, active])
  return level
}

/** A level as a short bar: green, amber near the top, red when it clips. */
function Meter({ level, className }: { level: number; className?: string }) {
  // Loudness is heard in decibels: -60 dB is the left end, 0 dB the right.
  const db = level > 0 ? 20 * Math.log10(level) : -90
  const fill = Math.min(1, Math.max(0, (db + 60) / 60))
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.07]', className)} role="meter" aria-valuenow={Math.round(db)} aria-valuemin={-60} aria-valuemax={0}>
      <div className={cn('h-full rounded-full transition-[width] duration-75', db > -1 ? 'bg-danger' : db > -9 ? 'bg-warn' : 'bg-ok')} style={{ width: `${fill * 100}%` }} />
    </div>
  )
}

/** Where a picture of this shape sits inside a box when it is fitted whole. */
function fitted(boxWidth: number, boxHeight: number, width: number, height: number) {
  const k = Math.min(boxWidth / width, boxHeight / height) || 1
  return { left: (boxWidth - width * k) / 2, top: (boxHeight - height * k) / 2, k }
}

/** Drag on the live picture to choose the part of it that is recorded. */
function RegionOverlay({ width, height, region, drawing, onChange }: { width: number; height: number; region: Rect | null; drawing: boolean; onChange: (r: Rect | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState<Rect | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const fit = fitted(box.w, box.h, width, height)
  // A point in the box, as pixels of the source.
  const toSource = (e: ReactPointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: Math.min(width, Math.max(0, (e.clientX - r.left - fit.left) / fit.k)), y: Math.min(height, Math.max(0, (e.clientY - r.top - fit.top) / fit.k)) }
  }
  const shown = drag ?? region
  return (
    <div
      ref={ref}
      className={cn('absolute inset-0', drawing && 'cursor-crosshair')}
      onPointerDown={(e) => {
        if (!drawing) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = toSource(e)
        setDrag({ ...start.current, width: 0, height: 0 })
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const p = toSource(e)
        setDrag({ x: Math.min(p.x, start.current.x), y: Math.min(p.y, start.current.y), width: Math.abs(p.x - start.current.x), height: Math.abs(p.y - start.current.y) })
      }}
      onPointerUp={() => {
        if (!start.current) return
        start.current = null
        // A click without a drag clears the region.
        onChange(drag ? fitRegion(drag, width, height) : null)
        setDrag(null)
      }}
    >
      {shown && shown.width > 0 && shown.height > 0 && (
        <div
          className="pointer-events-none absolute rounded-[3px] shadow-[0_0_0_9999px_rgb(from_var(--color-shade)_r_g_b/0.58)] ring-2 ring-accent"
          style={{ left: fit.left + shown.x * fit.k, top: fit.top + shown.y * fit.k, width: shown.width * fit.k, height: shown.height * fit.k }}
        >
          <span className="absolute -top-5 left-0 rounded bg-accent px-1 text-2xs font-semibold text-accent-fg tabular">
            {Math.round(shown.width)}×{Math.round(shown.height)}
          </span>
        </div>
      )}
    </div>
  )
}

function SourceCard({ source, selected, onPick }: { source: CaptureSource; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title={source.name}
      className={cn('group min-w-0 rounded-lg p-1 text-left transition-colors', selected ? 'bg-accent/12 ring-1 ring-accent/60' : 'hover:bg-ink/[0.05]')}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-shade/50">
        {source.thumbnail ? <img src={source.thumbnail} alt="" className="h-full w-full object-contain" draggable={false} /> : <div className="grid h-full place-items-center text-fg-4">{source.kind === 'screen' ? <Monitor className="size-5" /> : <AppWindow className="size-5" />}</div>}
        {source.minimized && <span className="absolute inset-x-0 bottom-0 bg-shade/70 px-1 py-0.5 text-center text-2xs text-fg-2">{tt('Minimized')}</span>}
      </div>
      <div className="mt-1 flex items-center gap-1 px-0.5">
        {source.icon && <img src={source.icon} alt="" className="size-3.5 shrink-0" draggable={false} />}
        <span className={cn('truncate text-2xs', selected ? 'text-fg' : 'text-fg-2')}>{source.own ? tt('Lumen (this window)') : source.name}</span>
      </div>
      {source.kind === 'screen' && source.width && source.height && <div className="px-0.5 text-2xs text-fg-4 tabular">{source.width}×{source.height}</div>}
      {source.kind === 'window' && source.process && <div className="truncate px-0.5 text-2xs text-fg-4">{source.process.replace(/\.exe$/i, '')}</div>}
    </button>
  )
}

function Heading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 pt-1 text-2xs font-semibold tracking-wide text-fg-3 uppercase [&_svg]:size-3.5">
      {icon}
      {children}
    </div>
  )
}

export function RecordDialog() {
  const open = useRecorder((s) => s.open)
  const phase = useRecorder((s) => s.phase)
  const settings = useRecorder((s) => s.settings)
  const sources = useRecorder((s) => s.sources)
  const stream = useRecorder((s) => s.stream)
  const preview = useRecorder((s) => s.preview)
  const sourceSize = useRecorder((s) => s.sourceSize)
  const ready = useRecorder((s) => s.ready)
  const countdown = useRecorder((s) => s.countdown)
  const stats = useRecorder((s) => s.stats)
  const markers = useRecorder((s) => s.markers)
  const notes = useRecorder((s) => s.notes)
  const error = useRecorder((s) => s.error)
  const helper = useRecorder((s) => s.helper)

  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [drawing, setDrawing] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [encoders, setEncoders] = useState<Partial<Record<ExportVideoCodec, CodecAvailability>>>({})
  const [folder, setFolder] = useState<CaptureFolderState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const idle = phase === 'idle'
  const rolling = phase === 'recording' || phase === 'paused'
  const source = sources.find((s) => s.id === settings.sourceId) ?? null
  const { mics, cameras } = useDevices(open)
  const micLevel = useMicLevel(settings.mic, open && idle)

  // The live picture.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = preview
  }, [preview, open])

  useEffect(() => {
    if (open && source) setTab(source.kind)
  }, [open, source?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !desktop) return
    void desktop.capture.folder().then(setFolder)
    // Windows come and go: the list is fresh every few seconds while it is being looked at.
    const timer = setInterval(() => {
      if (useRecorder.getState().phase === 'idle') void refreshSources().catch(() => {})
    }, 6000)
    return () => clearInterval(timer)
  }, [open])

  // What is recorded: the source's real size once its picture is here, what the list said until then.
  const srcWidth = ready?.srcWidth ?? sourceSize?.width ?? source?.width ?? 1920
  const srcHeight = ready?.srcHeight ?? sourceSize?.height ?? source?.height ?? 1080
  // The list's own figure for a window can be stale or in other units: the picture's is what counts.
  const known = Boolean(ready ?? sourceSize)
  const frame = captureFrame(srcWidth, srcHeight, settings.region, settings.resolution)
  const fps = settings.fps

  // Which encoders this computer has for the size about to be recorded.
  useEffect(() => {
    if (!open) return
    let alive = true
    void encoderSupport(frame.width, frame.height, fps).then((s) => alive && setEncoders(s))
    return () => {
      alive = false
    }
  }, [open, frame.width, frame.height, fps])

  const here = encoders[settings.codec]
  const encoderHint = ready
    ? ready.encoder
    : !here
      ? tt('Checking this computer’s encoders…')
      : settings.hardware
        ? here.hardware
          ? tt('The graphics card encodes')
          : tt('No graphics-card encoder for this here: another one is used')
        : here.software
          ? tt('The processor encodes: heavier, works everywhere')
          : tt('Only graphics cards encode this codec')
  const bitrate = ready?.bitrate ?? (settings.rate.mode === 'bitrate' ? settings.rate.mbps * 1e6 : videoBitrate(frame.width, frame.height, fps, settings.codec, settings.rate.quality))
  const sound = effectiveAudio(settings, source, helper)
  const perMinute = ((bitrate + (sound.audio === 'off' ? 0 : 192_000)) * 60) / 8

  const shown = sources.filter((s) => s.kind === tab)
  const set = updateSettings
  const close = () => {
    if (phase === 'idle' || rolling) closeRecorder()
  }

  const start = () => {
    setDrawing(false)
    void startRecording().catch(() => {})
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={tt('Record')}
      description={tt('A screen, a window or part of one, straight into the project.')}
      className="w-[min(1180px,calc(100vw-32px))]"
    >
      <div className="grid max-h-[calc(100vh-150px)] grid-cols-[1.32fr_1fr] gap-5 overflow-hidden px-5 pt-1 pb-4">
        {/* The picture and what to record */}
        <div className="flex min-h-0 flex-col">
          <div className="relative aspect-video shrink-0 overflow-hidden rounded-xl bg-shade shadow-[0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.08),0_16px_40px_-16px_rgb(from_var(--color-shade)_r_g_b/0.9)]">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-contain"
              // The picture changed shape: the window was resized.
              onResize={() => measureSource()}
            />
            {stream && <RegionOverlay width={srcWidth} height={srcHeight} region={settings.region} drawing={drawing && idle} onChange={(region) => (set({ region }), setDrawing(false))} />}
            {!stream && (
              <div className="absolute inset-0 grid place-items-center px-8 text-center text-sm text-fg-3">
                {error ? (
                  <span className="flex max-w-md items-start gap-2 text-left text-danger">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
                  </span>
                ) : (
                  tt('Pick a screen or a window below.')
                )}
              </div>
            )}
            <AnimatePresence>
              {phase === 'countdown' && (
                <motion.div key={countdown} initial={{ opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-shade/45 text-8xl font-semibold text-on-media tabular">
                  {countdown}
                </motion.div>
              )}
            </AnimatePresence>
            {rolling && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-shade/70 py-1 pr-2.5 pl-2 text-xs font-medium text-on-media tabular">
                <span className={cn('size-2 rounded-full bg-danger', phase === 'recording' && 'animate-pulse-soft')} />
                {phase === 'paused' ? tt('Paused') : tt('Recording')} · {fmtClock(stats.seconds)}
              </div>
            )}
            {drawing && idle && <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-on-media/85">{tt('Drag over the part to record · click once to clear')}</div>}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'screen', label: tt('Screens · {0}', sources.filter((s) => s.kind === 'screen').length), icon: <Monitor className="size-3.5" /> },
                { value: 'window', label: tt('Windows · {0}', sources.filter((s) => s.kind === 'window').length), icon: <AppWindow className="size-3.5" /> },
              ]}
            />
            <IconButton
              label={tt('Look again')}
              size="sm"
              disabled={refreshing || !idle}
              onClick={() => {
                setRefreshing(true)
                void refreshSources().finally(() => setRefreshing(false))
              }}
            >
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </IconButton>
            <span className="ml-auto truncate text-xs text-fg-3 tabular">
              {source && known ? `${srcWidth}×${srcHeight}${settings.region ? ` · ${tt('part {0}×{1}', frame.crop.width, frame.crop.height)}` : ''}` : ''}
            </span>
          </div>
          <div className={cn('mt-2 grid min-h-0 flex-1 grid-cols-4 content-start gap-1.5 overflow-y-auto pr-1', !idle && 'pointer-events-none opacity-50')}>
            {shown.map((s) => (
              <SourceCard key={s.id} source={s} selected={s.id === settings.sourceId} onPick={() => set({ sourceId: s.id, region: null })} />
            ))}
            {!shown.length && <p className="col-span-4 py-6 text-center text-xs text-fg-4">{tab === 'window' ? tt('No windows are open. Minimized windows can’t be recorded: bring one back first.') : tt('No screens found.')}</p>}
          </div>
        </div>

        {/* Settings */}
        <div className={cn('min-h-0 space-y-2.5 overflow-y-auto pr-1', !idle && 'pointer-events-none opacity-60')}>
          <Heading icon={<Scan />}>{tt('Picture')}</Heading>
          <Row label={tt('Resolution')}>
            <Select
              aria-label={tt('Resolution')}
              value={String(settings.resolution)}
              onChange={(v) => set({ resolution: (v === 'native' ? 'native' : Number(v)) as CaptureResolution })}
              className="w-full"
              options={CAPTURE_RESOLUTIONS.map((r) => {
                const f = captureFrame(srcWidth, srcHeight, settings.region, r.value)
                const bigger = r.value !== 'native' && f.width > frame.crop.width
                return { value: String(r.value), label: `${r.label} · ${f.width}×${f.height}${bigger ? ` ${tt('(scaled up)')}` : ''}` }
              })}
            />
          </Row>
          <Row label={tt('Frame rate')}>
            <Segmented value={String(settings.fps)} onChange={(v) => set({ fps: Number(v) })} options={CAPTURE_FPS.map((f) => ({ value: String(f), label: String(f) }))} stretch />
          </Row>
          <Row label={tt('Part')}>
            <Button size="sm" variant={drawing ? 'primary' : 'secondary'} onClick={() => setDrawing((d) => !d)} disabled={!stream}>
              <Scan /> {settings.region ? tt('Draw again') : tt('Draw a region')}
            </Button>
            {settings.region ? (
              <button type="button" onClick={() => set({ region: null })} className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg">
                <X className="size-3" />{' '}{tt('All of it')}
              </button>
            ) : (
              <span className="text-xs text-fg-4">{tt('All of it')}</span>
            )}
          </Row>
          <Row label={tt('Pointer')}>
            <Switch aria-label={tt('Show the pointer')} checked={settings.cursor} onChange={(cursor) => set({ cursor })} />
            <span className="text-xs text-fg-3">{settings.cursor ? tt('In the picture') : tt('Left out of the picture')}</span>
          </Row>
          <Row label={tt('Clicks')}>
            <Switch aria-label={tt('Record clicks and the pointer’s path')} checked={settings.cursorData} onChange={(cursorData) => set({ cursorData })} />
            <span className="flex items-center gap-1 text-xs text-fg-3">
              <MousePointer2 className="size-3.5 shrink-0" /> {settings.cursorData ? tt('Kept as data, for zooms on clicks later') : tt('Not kept')}
            </span>
          </Row>

          <Heading icon={<Volume2 />}>{tt('Sound')}</Heading>
          <Row label={tt('Computer')}>
            <Segmented
              value={settings.audio}
              onChange={(audio) => set({ audio })}
              stretch
              options={[
                { value: 'off', label: tt('Off') },
                { value: 'system', label: tt('Everything'), title: tt('Everything the computer plays') },
                { value: 'app', label: tt('This app only'), title: tt('Only the sound of the window being recorded') },
              ]}
            />
          </Row>
          {sound.note && <p className="pl-[84px] text-2xs leading-relaxed text-warn">{sound.note}</p>}
          {rolling && settings.audio !== 'off' && (
            <Row label="">
              <Meter level={stats.levels.audio ?? 0} />
            </Row>
          )}
          <Row label={tt('Microphone')}>
            <Select
              aria-label={tt('Microphone')}
              value={settings.mic ?? NONE}
              onChange={(v) => set({ mic: v === NONE ? null : v })}
              className="w-full"
              options={[{ value: NONE, label: tt('None') }, ...mics.map((d) => ({ value: d.deviceId, label: d.label || tt('Microphone') }))]}
            />
          </Row>
          {settings.mic && (
            <Row label="">
              <Mic className="size-3.5 shrink-0 text-fg-4" />
              <Meter level={rolling ? (stats.levels.mic ?? 0) : micLevel} />
            </Row>
          )}

          <Heading icon={<Camera />}>{tt('Camera')}</Heading>
          <Row label={tt('Camera')}>
            <Select
              aria-label={tt('Camera')}
              value={settings.webcam ?? NONE}
              onChange={(v) => set({ webcam: v === NONE ? null : v })}
              className="w-full"
              options={[{ value: NONE, label: tt('None') }, ...cameras.map((d) => ({ value: d.deviceId, label: d.label || tt('Camera') }))]}
            />
          </Row>
          {settings.webcam && (
            <Row label={tt('Size')}>
              <Segmented value={String(settings.webcamHeight)} onChange={(v) => set({ webcamHeight: Number(v) })} options={[{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }]} />
              <span className="text-xs text-fg-4">{tt('Its own clip, in the corner of the picture')}</span>
            </Row>
          )}

          <Heading icon={<Cpu />}>{tt('Encoding')}</Heading>
          <Row label={tt('Codec')}>
            <Segmented
              value={settings.codec}
              onChange={(codec) => set({ codec })}
              stretch
              options={(['avc', 'hevc', 'av1'] as CaptureCodec[]).map((c) => ({ value: c, label: CODEC_NAME[c], title: encoders[c] && !encoders[c]!.hardware && !encoders[c]!.software ? tt('Not available on this computer at this size: another codec is used') : undefined }))}
            />
          </Row>
          <Row label={tt('Encoder')}>
            <Segmented value={settings.hardware ? 'gpu' : 'cpu'} onChange={(v) => set({ hardware: v === 'gpu' })} options={[{ value: 'gpu', label: tt('Graphics card') }, { value: 'cpu', label: tt('Processor') }]} />
          </Row>
          <p className="pl-[84px] text-2xs leading-relaxed text-fg-4">{ttx('{0}. If it can’t take this size, the next one that can is used.', encoderHint)}</p>
          <Row label={tt('Quality')}>
            <Segmented
              value={settings.rate.mode}
              onChange={(mode) => set({ rate: mode === 'quality' ? { mode, quality: 60 } : { mode, mbps: Math.max(1, Math.round(bitrate / 1e6)) } })}
              options={[{ value: 'quality', label: tt('Auto') }, { value: 'bitrate', label: tt('Bitrate') }]}
            />
            {settings.rate.mode === 'quality' ? (
              <>
                <Slider value={settings.rate.quality} min={10} max={100} onChange={(quality) => set({ rate: { mode: 'quality', quality } })} />
                <span className="w-12 shrink-0 text-right text-xs font-medium text-fg-2">{QUALITY_LABEL(settings.rate.quality)}</span>
              </>
            ) : (
              <>
                <Input
                  aria-label={tt('Bitrate in megabits per second')}
                  type="number"
                  min={1}
                  max={400}
                  step={1}
                  value={settings.rate.mbps}
                  onChange={(e) => set({ rate: { mode: 'bitrate', mbps: Math.min(400, Math.max(0.5, Number(e.target.value) || 1)) } })}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-20"
                />
                <span className="text-xs text-fg-3">{tt('Mbps')}</span>
              </>
            )}
          </Row>
          <button type="button" onClick={() => setAdvanced((a) => !a)} className="pl-[84px] text-2xs font-medium text-fg-3 hover:text-fg">
            {advanced ? tt('Fewer settings') : tt('More settings')}
          </button>
          {advanced && (
            <>
              <Row label={tt('Key frames')}>
                <Select
                  aria-label={tt('Key frame interval')}
                  value={String(settings.keyframeSeconds)}
                  onChange={(v) => set({ keyframeSeconds: Number(v) })}
                  className="w-full"
                  options={[
                    { value: '1', label: tt('Every second: quickest to scrub') },
                    { value: '2', label: tt('Every 2 seconds') },
                    { value: '5', label: tt('Every 5 seconds') },
                    { value: '10', label: tt('Every 10 seconds: smallest files') },
                  ]}
                />
              </Row>
              {wideGamutDisplay() && (
                <Row label={tt('Colours')}>
                  <Segmented
                    value={settings.colour}
                    onChange={(colour) => set({ colour })}
                    options={[
                      { value: 'standard', label: tt('Standard'), title: tt('sRGB: what games and most apps mean') },
                      { value: 'display', label: tt('This screen’s'), title: tt('This screen shows more colours than sRGB. Browsers and design apps are recorded as they looked.') },
                    ]}
                  />
                </Row>
              )}
              <Row label={tt('Countdown')}>
                <Segmented value={String(settings.countdown)} onChange={(v) => set({ countdown: Number(v) })} options={[0, 3, 5, 10].map((n) => ({ value: String(n), label: n ? `${n} s` : tt('None') }))} />
              </Row>
              <Row label={tt('Lumen')}>
                <label className="flex items-center gap-1.5 text-xs text-fg-3">
                  <Switch aria-label={tt('Keep Lumen out of screen recordings')} checked={settings.hideLumen} onChange={(hideLumen) => set({ hideLumen })} />{' '}{tt('Not in the picture')}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-fg-3">
                  <Switch aria-label={tt('Minimize Lumen while recording')} checked={settings.minimize} onChange={(minimize) => set({ minimize })} />{' '}{tt('Minimized')}
                </label>
              </Row>
            </>
          )}

          <Heading icon={<FolderOpen />}>{tt('When it ends')}</Heading>
          <Row label={tt('Clips go')}>
            <Segmented value={settings.place} onChange={(place) => set({ place })} options={[{ value: 'timeline', label: tt('On the timeline') }, { value: 'library', label: tt('Media library only') }]} />
          </Row>
          <Row label={tt('Saved in')}>
            <span className="min-w-0 flex-1 truncate text-xs text-fg-3" title={folder?.folder}>
              {folder?.folder ?? '…'}
            </span>
            <button type="button" className="shrink-0 text-xs font-medium text-fg-2 hover:text-fg" onClick={() => void desktop?.capture.pickFolder().then(setFolder)}>
              {tt('Change…')}
            </button>
          </Row>
        </div>
      </div>

      {/* What will happen, and the button that does it */}
      <div className="flex items-center gap-3 border-t border-line bg-shade/15 px-5 py-3.5">
        {rolling || phase === 'finishing' ? (
          <>
            <div className="min-w-0 flex-1 text-xs text-fg-3 tabular">
              <span className="text-fg-2">{fmtBytes(stats.bytes)}</span>{' '}{ttx('· {0} · {1} Mbps', stats.sourceFps ? tt('{0} fps from the source', stats.sourceFps.toFixed(0)) : tt('nothing moving'), (stats.bitrate / 1e6).toFixed(1))}
              {stats.dropped > 0 && <span className="text-warn">{' '}{ttx('· {0} frames skipped', stats.dropped)}</span>}
              {markers.length > 0 && (' ' + tt('· {0} marker{1}', markers.length, markers.length > 1 ? 's' : ''))}
              {stats.free !== undefined && stats.free < 5e9 && <span className="text-warn">{' '}{ttx('· {0} free', fmtBytes(stats.free))}</span>}
              {notes.length > 0 && <div className="truncate text-warn" title={notes.join('\n')}>{notes[notes.length - 1]}</div>}
            </div>
            <Button variant="secondary" size="md" onClick={() => addMarker()} disabled={phase === 'finishing'} title={tt('Mark this moment ({0})', CAPTURE_HOTKEYS.marker.label)}>
              <Flag />{' '}{tt('Marker')}
            </Button>
            <Button variant="secondary" size="md" onClick={togglePause} disabled={phase === 'finishing'} title={CAPTURE_HOTKEYS.pause.label}>
              {phase === 'paused' ? <Play /> : <Pause />} {phase === 'paused' ? tt('Resume') : tt('Pause')}
            </Button>
            <Button variant="danger" size="md" onClick={() => void stopRecording().catch(() => {})} disabled={phase === 'finishing'} title={CAPTURE_HOTKEYS.toggle.label}>
              <Square fill="currentColor" /> {phase === 'finishing' ? tt('Finishing…') : tt('Stop')}
            </Button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1 text-xs leading-relaxed text-fg-3">
              <div className="truncate text-fg-2 tabular">
                {ttx('{0}×{1} · {2} fps · about {3} Mbps · {4} a minute', frame.width, frame.height, fps, (bitrate / 1e6).toFixed(0), fmtBytes(perMinute))}
              </div>
              <div className="truncate">
                {ttx('{0} starts and stops · {1} pauses · {2} marks a moment', CAPTURE_HOTKEYS.toggle.label, CAPTURE_HOTKEYS.pause.label, CAPTURE_HOTKEYS.marker.label)}
              </div>
              {error && stream && <div className="truncate text-danger" title={error}>{error}</div>}
            </div>
            {phase === 'idle' ? (
              <Button variant="danger" size="lg" onClick={start} disabled={!source || !stream} className="bg-danger text-on-media hover:bg-danger/90">
                <span className="size-2.5 rounded-full bg-ink" />{' '}{tt('Record')}
              </Button>
            ) : (
              <Button variant="secondary" size="lg" onClick={() => void stopRecording().catch(() => {})}>
                {phase === 'countdown' ? tt('Starting in {0}… Cancel', countdown) : tt('Getting ready… Cancel')}
              </Button>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
