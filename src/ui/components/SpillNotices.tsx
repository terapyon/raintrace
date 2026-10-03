import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Snackbar from '@mui/material/Snackbar'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { SimulationStore, SpillNotice } from '../../state/simulationStore'
import { formatElapsed, formatMeters } from '../format'
import { strings } from '../strings'

/** 一覧の高さの上限（px）。普段は見ないので、パネルの一番下に置き、これを超えたら一覧の中でスクロールする */
export const SPILL_LIST_MAX_HEIGHT_PX = 160

const message = (spill: SpillNotice): string =>
  strings.spill.started(formatMeters(spill.spillElevation), formatElapsed(spill.timeS))

/**
 * 越流イベント（base-spec §21、spec 04 §5.3）。最新のものを Snackbar で知らせ、パネルの一番下に一覧を残す。
 * 一覧は起きた順に並べ、高さの上限を超えたら一覧の中でスクロールする。新しい越流が届いたら最新の行まで送る
 */
export function SpillNotices({ simulation }: { simulation: SimulationStore }) {
  const spills = useStore(simulation, (s) => s.spills)
  // 知らせ終えた最後のもの。Reset で一覧が新しくなると、新しい越流はまた知らせる
  const [acknowledged, setAcknowledged] = useState<SpillNotice | null>(null)
  const latest = spills.at(-1)
  const listRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 件数が増えたときに最新の行まで送る
  useEffect(() => {
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [spills.length])
  return (
    <>
      {spills.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2">{strings.spill.title}</Typography>
          <Box
            ref={listRef}
            data-testid="spill-list"
            // スクロールする領域はキーボードでも動かせるように焦点を受ける
            tabIndex={0}
            aria-label={strings.spill.listAria}
            sx={{ maxHeight: SPILL_LIST_MAX_HEIGHT_PX, overflowY: 'auto' }}
          >
            {spills.map((spill) => (
              <Typography key={`${spill.depressionId}-${spill.step}`} variant="body2">
                {message(spill)}
              </Typography>
            ))}
          </Box>
        </>
      )}
      <Snackbar
        open={latest !== undefined && latest !== acknowledged}
        autoHideDuration={6000}
        onClose={() => setAcknowledged(latest ?? null)}
        message={latest === undefined ? '' : message(latest)}
      />
    </>
  )
}
