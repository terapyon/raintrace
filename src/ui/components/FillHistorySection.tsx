import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { useStore } from 'zustand'
import type { FillCandidate } from '../../shared/protocol'
import {
  formatArea,
  formatDemLabel,
  formatOffsetM,
  formatRise,
  formatVolumeApprox,
} from '../format'
import { strings } from '../strings'
import type { TerrainSession } from '../terrainSession'

const t = strings.fillHistory

/** 一覧の行と詳しい欄が共有する、候補の数値の行 */
function candidateLines(c: FillCandidate): string[] {
  return [
    formatArea(c.areaM2),
    formatRise(c.maxRiseM),
    t.volume(formatVolumeApprox(c.volumeM3)),
    t.evidence[c.evidence],
  ]
}

/** 選んだ範囲の詳しい欄。10 の「崩れたと仮定する」のボタンは、この欄の末尾に入る */
function CandidateDetail({ candidate }: { candidate: FillCandidate }) {
  return (
    <Box
      role="region"
      aria-label={t.detailAria}
      data-testid="fill-detail"
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1, mt: 1 }}
    >
      <Typography variant="subtitle2">{t.rowId(candidate.id)}</Typography>
      {candidateLines(candidate).map((line) => (
        <Typography key={line} variant="body2">
          {line}
        </Typography>
      ))}
      {candidate.evidenceSources.includes('a54') && (
        <Typography variant="body2">
          {t.a54Overlap(candidate.a54Type === undefined ? null : t.a54Types[candidate.a54Type])}
        </Typography>
      )}
      {candidate.evidenceSources.includes('landform') && (
        <Typography variant="body2">{t.landformOverlap}</Typography>
      )}
    </Box>
  )
}

/**
 * 盛土の履歴（spec 09 §6）。スイッチ・状態の文言・比べたデータ・ずれの補正・
 * 「標高差の大きい範囲」の一覧・選んだ範囲の詳しい欄・注意書き
 */
export function FillHistorySection({ session }: { session: TerrainSession }) {
  const store = session.store
  const fill = useStore(store, (s) => s.fillHistory)
  const breakdown = useStore(store, (s) => s.summary?.breakdown)
  const { enabled, status, summary, selectedId } = fill
  return (
    <>
      <Typography variant="subtitle2">{t.title}</Typography>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={enabled}
            onChange={(_, checked) => store.getState().setFillHistoryEnabled(checked)}
          />
        }
        label={t.enable}
      />
      {status === 'waiting' && <Typography variant="body2">{t.waiting}</Typography>}
      {status === 'loading' && (
        <Box sx={{ my: 1 }}>
          <Typography variant="body2">{t.loading}</Typography>
          <LinearProgress />
        </Box>
      )}
      {status === 'unavailable' && (
        <Alert severity="info" sx={{ my: 1 }}>
          {t.unavailable}
        </Alert>
      )}
      {status === 'no-overlap' && (
        <Alert severity="info" sx={{ my: 1 }}>
          {t.noOverlap}
        </Alert>
      )}
      {enabled && (status === 'ready' || status === 'no-overlap') && (
        <>
          <Typography variant="body2">{t.past}</Typography>
          {breakdown !== undefined && (
            <Typography variant="body2">{t.now(formatDemLabel(breakdown))}</Typography>
          )}
        </>
      )}
      {status === 'failed' && (
        <Alert severity="error" sx={{ my: 1 }}>
          {t.failed}
        </Alert>
      )}
      {status === 'ready' && summary !== null && (
        <>
          {!summary.landformAvailable && (
            <Alert severity="warning" sx={{ my: 1 }}>
              {t.landformFailed}
            </Alert>
          )}
          {!summary.a54Available && (
            <Alert severity="warning" sx={{ my: 1 }}>
              {t.a54Failed}
            </Alert>
          )}
          <Typography variant="body2" data-testid="fill-offset">
            {t.offset(formatOffsetM(summary.offsetM))}
          </Typography>
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            {t.listTitle}
          </Typography>
          {summary.candidates.length === 0 ? (
            <Typography variant="body2">{t.none}</Typography>
          ) : (
            <Box
              component="ul"
              sx={{ listStyle: 'none', m: 0, p: 0, maxHeight: '40dvh', overflowY: 'auto' }}
            >
              {summary.candidates.map((c) => (
                <li key={c.id}>
                  <ButtonBase
                    data-testid={`fill-row-${c.id}`}
                    aria-pressed={c.id === selectedId}
                    onClick={() => {
                      store.getState().selectFillCandidate(c.id)
                      session.focusFillCandidate(c.id)
                    }}
                    sx={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      p: 0.5,
                      borderRadius: 1,
                      bgcolor: c.id === selectedId ? 'action.selected' : undefined,
                      '&.Mui-focusVisible': {
                        outline: 2,
                        outlineStyle: 'solid',
                        outlineColor: 'primary.main',
                      },
                    }}
                  >
                    <Typography variant="body2" component="span">
                      {[t.rowId(c.id), ...candidateLines(c)].join(t.rowSeparator)}
                    </Typography>
                  </ButtonBase>
                  {c.id === selectedId && <CandidateDetail candidate={c} />}
                </li>
              ))}
            </Box>
          )}
        </>
      )}
      {enabled && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          {t.notice}
        </Typography>
      )}
    </>
  )
}
