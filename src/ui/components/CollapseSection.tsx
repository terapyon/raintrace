import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import LinearProgress from '@mui/material/LinearProgress'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { MAX_SHOWN_DAMS } from '../../shared/damDisplay'
import { DEBRIS_PRESETS } from '../../shared/debrisPresets'
import type { CollapseRatio } from '../../shared/protocol'
import type { CollapseSummary } from '../../state/appStore'
import { formatArea, formatMeters, formatVolumeApprox } from '../format'
import { strings } from '../strings'
import type { TerrainSession } from '../terrainSession'

const t = strings.collapse
const RATIOS: readonly CollapseRatio[] = [1, 0.5, 0.25]

function ResultLines({ summary }: { summary: CollapseSummary }) {
  const outside = summary.outsideM3 > 0
  const dammedWater = summary.dams.reduce((sum, d) => sum + d.capacityM3, 0)
  return (
    <Box sx={{ mt: 1 }} data-testid="collapse-result">
      <Typography variant="body2">
        {t.collapsed}: {formatVolumeApprox(summary.collapsedM3)}
      </Typography>
      <Typography variant="body2">
        {t.deposited}: {formatVolumeApprox(summary.depositedM3)}
        {outside && t.outside(formatVolumeApprox(summary.outsideM3))}
      </Typography>
      {outside && (
        <Alert severity="info" sx={{ my: 0.5 }}>
          {t.outsideNotice(formatVolumeApprox(summary.outsideM3))}
        </Alert>
      )}
      {summary.dams.length === 0 ? (
        <Typography variant="body2">{t.noDams}</Typography>
      ) : (
        <>
          <Typography variant="body2">
            {t.dams(summary.dams.length, formatVolumeApprox(dammedWater))}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {summary.dams.slice(0, MAX_SHOWN_DAMS).map((d, i) => (
              <li key={d.depressionId}>
                <Typography variant="caption">
                  {t.damRow(
                    i + 1,
                    strings.fillHistory.rowSeparator,
                    formatVolumeApprox(d.capacityM3),
                    formatMeters(d.maxDepthM),
                    formatMeters(d.spillElevation),
                    formatArea(d.areaM2),
                  )}
                </Typography>
              </li>
            ))}
          </Box>
          {summary.dams.length > MAX_SHOWN_DAMS && (
            <Typography variant="caption" component="p">
              {t.damsMore(summary.dams.length - MAX_SHOWN_DAMS)}
            </Typography>
          )}
        </>
      )}
    </Box>
  )
}

/**
 * 崩れたと仮定した場合（spec 10 §6.1）。盛土の履歴の区切りの直後に出す。
 * 候補の詳しい欄の「崩れたと仮定する」で開き（openCollapse）、候補の選択を外すと閉じる
 */
export function CollapseSection({ session }: { session: TerrainSession }) {
  const app = session.store
  const collapse = useStore(app, (s) => s.collapse)
  const candidate = useStore(app, (s) =>
    s.fillHistory.summary?.candidates.find((c) => c.id === s.collapse.candidateId),
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const openId = collapse.candidateId
  // 開いたとき（候補が替わったときも）、狭い画面で見えない位置にあるパネルの中でも見えるようにする
  useEffect(() => {
    if (openId !== null) rootRef.current?.scrollIntoView?.({ block: 'start' })
  }, [openId])
  if (collapse.candidateId === null) return null
  const { status, summary, swapping } = collapse
  const actions = app.getState()
  const locked = status === 'computing' || swapping
  const canCompute = status === 'idle' || status === 'failed'
  return (
    <Box ref={rootRef} data-testid="collapse-section" sx={{ mt: 1 }}>
      <Divider sx={{ mb: 1 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">{t.title}</Typography>
        <Button size="small" onClick={() => actions.closeCollapse()}>
          {t.close}
        </Button>
      </Box>
      {candidate !== undefined && (
        <Typography variant="body2">
          {t.target(
            strings.fillHistory.rowId(candidate.id),
            strings.fillHistory.volume(formatVolumeApprox(candidate.volumeM3)),
            strings.fillHistory.evidence[candidate.evidence],
          )}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t.ratio}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        aria-label={t.ratio}
        value={collapse.ratio}
        disabled={locked}
        onChange={(_, value: CollapseRatio | null) => {
          if (value !== null) actions.setCollapseRatio(value)
        }}
      >
        {RATIOS.map((r) => (
          <ToggleButton key={r} value={r}>
            {t.ratios[r]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t.preset}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        aria-label={t.preset}
        value={collapse.presetId}
        disabled={locked}
        onChange={(_, value: string | null) => {
          if (value !== null) actions.setCollapsePreset(value)
        }}
      >
        {DEBRIS_PRESETS.map((p) => (
          <Tooltip key={p.id} title={p.description} describeChild>
            <ToggleButton value={p.id}>{p.label}</ToggleButton>
          </Tooltip>
        ))}
      </ToggleButtonGroup>
      {canCompute && (
        <Box sx={{ mt: 1 }}>
          <Button variant="contained" size="small" onClick={() => void session.collapse.compute()}>
            {t.compute}
          </Button>
        </Box>
      )}
      {status === 'computing' && (
        <Box sx={{ my: 1 }}>
          <Typography variant="body2">{t.computing}</Typography>
          <LinearProgress
            aria-label={t.computing}
            variant="determinate"
            value={collapse.progress * 100}
          />
        </Box>
      )}
      {status === 'failed' && (
        <Alert severity="error" sx={{ my: 1 }}>
          {t.failed}
        </Alert>
      )}
      {status === 'ready' && summary !== null && <ResultLines summary={summary} />}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {t.notice}
      </Typography>
    </Box>
  )
}
