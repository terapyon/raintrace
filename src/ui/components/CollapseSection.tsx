import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useStore } from 'zustand'
import { DEBRIS_PRESETS } from '../../shared/debrisPresets'
import type { CollapseRatio } from '../../shared/protocol'
import type { CollapseSummary, CompareSummary } from '../../state/appStore'
import {
  formatArea,
  formatMeters,
  formatSignedArea,
  formatSignedMeters,
  formatSignedVolume,
  formatVolume,
  formatVolumeApprox,
} from '../format'
import { strings } from '../strings'
import type { TerrainSession } from '../terrainSession'

const t = strings.collapse
const RATIOS: readonly CollapseRatio[] = [1, 0.5, 0.25]

function formatRemaining(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  return minutes <= 1 && seconds < 60 ? t.remainingLessThanMinute : t.remainingMinutes(minutes)
}

function ResultLines({ summary }: { summary: CollapseSummary }) {
  const outside = summary.outsideM3 > 0
  const dammedWater = summary.dams.reduce((sum, d) => sum + d.addedCapacityM3, 0)
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
            {summary.dams.map((d) => (
              <li key={d.depressionId}>
                <Typography variant="caption">
                  {t.damRow(
                    d.depressionId,
                    formatVolumeApprox(d.capacityM3),
                    formatMeters(d.maxDepthM),
                    formatMeters(d.spillElevation),
                    formatArea(d.areaM2),
                  )}
                </Typography>
              </li>
            ))}
          </Box>
        </>
      )}
    </Box>
  )
}

function CompareTable({ summary }: { summary: CompareSummary }) {
  const { before, after } = summary
  const rows: { label: string; before: string; after: string; diff: string }[] = [
    {
      label: t.table.maxDepth,
      before: formatMeters(before.maxDepth),
      after: formatMeters(after.maxDepth),
      diff: formatSignedMeters(after.maxDepth - before.maxDepth),
    },
    {
      label: t.table.floodedArea,
      before: formatArea(before.floodedArea),
      after: formatArea(after.floodedArea),
      diff: formatSignedArea(after.floodedArea - before.floodedArea),
    },
    {
      label: t.table.storedWater,
      before: formatVolume(before.storedWater),
      after: formatVolume(after.storedWater),
      diff: formatSignedVolume(after.storedWater - before.storedWater),
    },
    {
      label: t.table.outflowWater,
      before: formatVolume(before.outflowWater),
      after: formatVolume(after.outflowWater),
      diff: formatSignedVolume(after.outflowWater - before.outflowWater),
    },
  ]
  return (
    <Box sx={{ mt: 1 }} data-testid="compare-result">
      <Typography variant="caption" component="p">
        {t.compareAt}
      </Typography>
      <Table size="small" sx={{ '& td, & th': { px: 0.5, py: 0.25, fontSize: 12 } }}>
        <TableHead>
          <TableRow>
            <TableCell />
            <TableCell align="right">{t.table.before}</TableCell>
            <TableCell align="right">{t.table.after}</TableCell>
            <TableCell align="right">{t.table.diff}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell component="th" scope="row">
                {r.label}
              </TableCell>
              <TableCell align="right">{r.before}</TableCell>
              <TableCell align="right">{r.after}</TableCell>
              <TableCell align="right">{r.diff}</TableCell>
            </TableRow>
          ))}
          {summary.damMaxDepthM !== null && (
            <TableRow>
              <TableCell component="th" scope="row">
                {t.table.damMaxDepth}
              </TableCell>
              <TableCell align="right">—</TableCell>
              <TableCell align="right">{formatMeters(summary.damMaxDepthM)}</TableCell>
              <TableCell align="right">—</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Typography variant="body2">{t.newWater(formatArea(summary.newWaterAreaM2))}</Typography>
    </Box>
  )
}

/**
 * 崩れたと仮定した場合（spec 10 §6.1）。盛土の履歴の区切りの直後に出す。
 * 候補の詳しい欄の「崩れたと仮定する」で開き（openCollapse）、候補の選択を外すと閉じる
 */
export function CollapseSection({
  session,
  heavyRain,
}: {
  session: TerrainSession
  /** 範囲全体の雨、または範囲 1000 m（比べる計算に数分以上かかりうる） */
  heavyRain: boolean
}) {
  const app = session.store
  const collapse = useStore(app, (s) => s.collapse)
  const candidate = useStore(app, (s) =>
    s.fillHistory.summary?.candidates.find((c) => c.id === s.collapse.candidateId),
  )
  if (collapse.candidateId === null) return null
  const { status, summary, compare, swapping } = collapse
  const actions = app.getState()
  const canCompute = status === 'idle' || status === 'failed'
  const side = compare.side
  return (
    <Box data-testid="collapse-section" sx={{ mt: 1 }}>
      <Typography variant="subtitle2">{t.title}</Typography>
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
        disabled={status === 'computing'}
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
        disabled={status === 'computing'}
        onChange={(_, value: string | null) => {
          if (value !== null) actions.setCollapsePreset(value)
        }}
      >
        {DEBRIS_PRESETS.map((p) => (
          <Tooltip key={p.id} title={p.description}>
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
          <LinearProgress variant="determinate" value={collapse.progress * 100} />
        </Box>
      )}
      {status === 'failed' && (
        <Alert severity="error" sx={{ my: 1 }}>
          {t.failed}
        </Alert>
      )}
      {status === 'ready' && summary !== null && (
        <>
          <ResultLines summary={summary} />
          <Box sx={{ mt: 1 }}>
            {compare.status !== 'running' && (
              <>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={swapping}
                  onClick={() => void session.collapse.compare()}
                >
                  {t.compare}
                </Button>
                <Typography variant="caption" component="p">
                  {t.compareHint}
                </Typography>
                {heavyRain && (
                  <Typography variant="caption" component="p">
                    {t.compareSlow}
                  </Typography>
                )}
              </>
            )}
            {compare.status === 'running' && (
              <Box data-testid="compare-progress">
                <Typography variant="body2">
                  {t.compareRunning(
                    side === null ? '' : t.sides[side],
                    compare.remainingS === null ? null : formatRemaining(compare.remainingS),
                  )}
                </Typography>
                {(['before', 'after'] as const).map((s) => (
                  <LinearProgress
                    key={s}
                    aria-label={t.sides[s]}
                    variant="determinate"
                    sx={{ my: 0.5 }}
                    value={
                      side === s
                        ? compare.progress * 100
                        : side === 'after' && s === 'before'
                          ? 100
                          : 0
                    }
                  />
                ))}
                <Button size="small" onClick={() => session.collapse.cancelCompare()}>
                  {t.cancel}
                </Button>
              </Box>
            )}
            {compare.status === 'failed' && (
              <Alert severity="error" sx={{ my: 1 }}>
                {t.compareFailed}
              </Alert>
            )}
            {compare.status === 'done' && compare.summary !== null && (
              <CompareTable summary={compare.summary} />
            )}
          </Box>
        </>
      )}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {t.notice}
      </Typography>
    </Box>
  )
}
