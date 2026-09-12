import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import { useStore } from 'zustand'
import type { DisplayStats, SimulationStore } from '../../state/simulationStore'
import { formatArea, formatMeters, formatStep, formatStepsPerSecond, formatVolume } from '../format'
import { strings } from '../strings'

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
