import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import type { PlaybackSpeed } from '../../shared/protocol'
import type { PlaybackStatus } from '../../state/simulationStore'
import { strings } from '../strings'

const SPEEDS: readonly PlaybackSpeed[] = [0.25, 0.5, 1, 2, 4, 'max']

interface Props {
  status: PlaybackStatus
  canStart: boolean
  speed: PlaybackSpeed
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStep: () => void
  onReset: () => void
  onSpeedChange: (speed: PlaybackSpeed) => void
}

/**
 * 再生（spec 04 §3、base-spec §34）。主ボタンは 開始 → 一時停止 → 再開 と文言だけが変わる同じ要素なので、
 * キーボードの焦点が外れない（計画で決めたこと 7）。平衡の後は回しても何も変わらないので、
 * 押せるのは「リセット」だけ（主ボタンと「1 step 進める」は disabled）
 */
export function PlaybackControls(props: Props) {
  const { status, canStart, speed } = props
  const primary =
    status === 'idle'
      ? { label: strings.playback.start, onClick: props.onStart }
      : status === 'running'
        ? { label: strings.playback.pause, onClick: props.onPause }
        : { label: strings.playback.resume, onClick: props.onResume }
  const settled = status === 'settled'
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          disabled={settled || (status === 'idle' && !canStart)}
          onClick={primary.onClick}
        >
          {primary.label}
        </Button>
        <Button variant="outlined" disabled={status !== 'paused'} onClick={props.onStep}>
          {strings.playback.step}
        </Button>
        <Button variant="outlined" disabled={status === 'idle'} onClick={props.onReset}>
          {strings.playback.reset}
        </Button>
      </Box>
      <ToggleButtonGroup
        size="small"
        exclusive
        aria-label={strings.playback.speed}
        value={speed}
        onChange={(_, value: PlaybackSpeed | null) => {
          if (value !== null) props.onSpeedChange(value)
        }}
      >
        {SPEEDS.map((s) => (
          <ToggleButton key={String(s)} value={s}>
            {s === 'max' ? strings.playback.max : strings.playback.speedValue(s)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  )
}
