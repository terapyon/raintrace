import Box from '@mui/material/Box'
import Slider from '@mui/material/Slider'
import TextField from '@mui/material/TextField'
import { AMOUNT_MM, RADIUS_MIN_M } from '../../state/persistedSettings'
import { strings } from '../strings'

interface Props {
  amountText: string
  radiusText: string
  maxRadiusM: number
  amountInvalid: boolean
  radiusInvalid: boolean
  /** 開始の後はリセットするまで入力できない（spec 04 §3） */
  disabled: boolean
  onAmountChange: (text: string) => void
  onRadiusChange: (text: string) => void
}

/** 雨量と半径（base-spec §10、spec 04 §9）。入力欄とスライダーは同じ値を持つ */
export function RainfallControls(props: Props) {
  const { amountText, radiusText, maxRadiusM, amountInvalid, radiusInvalid, disabled } = props
  const sliderValue = (text: string, min: number, max: number): number => {
    const value = Number(text)
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <TextField
        label={strings.rainfall.amount}
        size="small"
        value={amountText}
        disabled={disabled}
        error={amountInvalid}
        helperText={amountInvalid ? strings.rainfall.amountError : undefined}
        onChange={(event) => props.onAmountChange(event.target.value)}
        slotProps={{ htmlInput: { inputMode: 'numeric' } }}
      />
      <Slider
        aria-label={strings.rainfall.amountSlider}
        size="small"
        min={AMOUNT_MM.min}
        max={AMOUNT_MM.max}
        step={1}
        disabled={disabled}
        value={sliderValue(amountText, AMOUNT_MM.min, AMOUNT_MM.max)}
        onChange={(_, value) => props.onAmountChange(String(value))}
      />
      <TextField
        label={strings.rainfall.radius}
        size="small"
        value={radiusText}
        disabled={disabled}
        error={radiusInvalid}
        helperText={radiusInvalid ? strings.rainfall.radiusError(maxRadiusM) : undefined}
        onChange={(event) => props.onRadiusChange(event.target.value)}
        slotProps={{ htmlInput: { inputMode: 'decimal' } }}
      />
      <Slider
        aria-label={strings.rainfall.radiusSlider}
        size="small"
        min={RADIUS_MIN_M}
        max={maxRadiusM}
        step={1}
        disabled={disabled}
        value={sliderValue(radiusText, RADIUS_MIN_M, maxRadiusM)}
        onChange={(_, value) => props.onRadiusChange(String(value))}
      />
    </Box>
  )
}
