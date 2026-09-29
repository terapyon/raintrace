import IconButton from '@mui/material/IconButton'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import { createSvgIcon } from '@mui/material/utils'
import { useStore } from 'zustand'
import type { DisplayStats, SimulationStore } from '../../state/simulationStore'
import { formatArea, formatMeters, formatStep, formatStepsPerSecond, formatVolume } from '../format'
import { strings } from '../strings'

/**
 * 丸の中の「i」（spec 07 §4.1 の InfoOutlined の代わり。@mui/icons-material は依存に無いので、同じ種類の形を
 * 自作する。計画で決めたこと 12）
 */
const InfoIcon = createSvgIcon(
  <>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="11" y="10" width="2" height="7" />
    <rect x="11" y="6.5" width="2" height="2" />
  </>,
  'Info',
)

/**
 * 領域外流出量の説明（spec 07 §4.1）。キーボードで焦点を移せ（IconButton）、焦点・ホバー・タップ（enterTouchDelay 0）
 * で開く。describeChild で、ボタンの名前は「領域外流出量の説明」、説明文はツールチップにする
 */
function OutflowHelp() {
  return (
    <Tooltip
      title={strings.stats.outflowHelp}
      describeChild
      enterTouchDelay={0}
      leaveTouchDelay={5000}
    >
      <IconButton
        size="small"
        aria-label={strings.stats.outflowHelpLabel}
        sx={{ ml: 0.5, p: 0.25 }}
      >
        <InfoIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  )
}

const ZERO: DisplayStats = {
  step: 0,
  totalWater: 0,
  storedWater: 0,
  outflowWater: 0,
  maxDepth: 0,
  floodedArea: 0,
  settled: false,
  massError: 0,
}

/** 統計（base-spec §38、spec 04 §6.3）。描画内容を文字で補う（tech-spec §9.5） */
export function StatisticsPanel({ simulation }: { simulation: SimulationStore }) {
  const s = useStore(simulation, (state) => state.stats) ?? ZERO
  const rate = useStore(simulation, (state) => state.stepsPerSecond)
  const rows: [string, string, string][] = [
    [strings.stats.step, formatStep(s.step), 'stat-step'],
    [strings.stats.total, formatVolume(s.totalWater), 'stat-total'],
    [strings.stats.stored, formatVolume(s.storedWater), 'stat-stored'],
    [strings.stats.outflow, formatVolume(s.outflowWater), 'stat-outflow'],
    [strings.stats.maxDepth, formatMeters(s.maxDepth), 'stat-max-depth'],
    [strings.stats.floodedArea, formatArea(s.floodedArea), 'stat-flooded-area'],
    [strings.stats.speed, formatStepsPerSecond(rate), 'stat-speed'],
  ]
  return (
    <Table size="small" aria-label={strings.stats.title}>
      <TableBody>
        {rows.map(([label, value, testId]) => (
          <TableRow key={testId}>
            <TableCell component="th" scope="row" sx={{ pl: 0 }}>
              {label}
              {testId === 'stat-outflow' && <OutflowHelp />}
            </TableCell>
            <TableCell align="right" data-testid={testId} sx={{ pr: 0 }}>
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
