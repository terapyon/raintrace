import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import OutlinedInput from '@mui/material/OutlinedInput'
import Slider from '@mui/material/Slider'
import { useId } from 'react'
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

interface NumberFieldProps {
  label: string
  value: string
  disabled: boolean
  error: boolean
  helperText: string | undefined
  inputMode: 'numeric' | 'decimal'
  onChange: (text: string) => void
}

/**
 * TextField と同じ見た目と関連づけ（label の for、説明文の aria-describedby）の入力欄。TextField は本アプリが
 * 使わない Select・Menu・Popover の実装まで静的に読み、ui のチャンクを予算の 150 KB から押し上げるので使わない
 * （tech-spec §14.2、spec 06 §5.2、RB-1 の順序）
 */
function NumberField(props: NumberFieldProps) {
  const { label, value, disabled, error, helperText, inputMode, onChange } = props
  const id = useId()
  const helperId = `${id}-helper`
  return (
    <FormControl size="small" variant="outlined" disabled={disabled} error={error}>
      <InputLabel htmlFor={id}>{label}</InputLabel>
      <OutlinedInput
        id={id}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{
          input: {
            inputMode,
            ...(helperText === undefined ? {} : { 'aria-describedby': helperId }),
          },
        }}
      />
      {helperText === undefined ? null : (
        <FormHelperText id={helperId}>{helperText}</FormHelperText>
      )}
    </FormControl>
  )
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
      <NumberField
        label={strings.rainfall.amount}
        value={amountText}
        disabled={disabled}
        error={amountInvalid}
        helperText={amountInvalid ? strings.rainfall.amountError : undefined}
        inputMode="numeric"
        onChange={props.onAmountChange}
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
      <NumberField
        label={strings.rainfall.radius}
        value={radiusText}
        disabled={disabled}
        error={radiusInvalid}
        helperText={radiusInvalid ? strings.rainfall.radiusError(maxRadiusM) : undefined}
        inputMode="decimal"
        onChange={props.onRadiusChange}
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
