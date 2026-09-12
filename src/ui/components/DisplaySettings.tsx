import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useStore } from 'zustand'
import type { AppStore } from '../../state/appStore'
import { ARROW_SPACINGS, type PersistedSettings } from '../../state/persistedSettings'
import type { SettingsStore } from '../../state/settingsStore'
import { strings } from '../strings'
import { DepressionLegend } from './DepressionLegend'
import { Row } from './TerrainInfo'
import { WaterLegend } from './WaterLegend'

type Display = PersistedSettings['display']

/**
 * 表示の切り替え（spec 04 §6）。水の流れ・配色・矢印の間隔は保存する設定、標高・窪地・地形の流向は
 * 02 の画面の一時状態（計画で決めたこと 10）
 */
export function DisplaySettings({ app, settings }: { app: AppStore; settings: SettingsStore }) {
  const layers = useStore(app, (s) => s.display)
  const display = useStore(settings, (s) => s.display)
  const setLayer = useStore(app, (s) => s.setDisplay)
  const setDisplay = (patch: Partial<Display>): void => settings.getState().setDisplay(patch)
  return (
    <>
      <Typography variant="subtitle2">{strings.panel.display}</Typography>
      <Row label={strings.display.waterPalette}>
        <ToggleButtonGroup
          size="small"
          exclusive
          aria-label={strings.display.waterPalette}
          value={display.waterDepthPalette}
          onChange={(_, value: Display['waterDepthPalette'] | null) => {
            if (value !== null) setDisplay({ waterDepthPalette: value })
          }}
        >
          <ToggleButton value="stepped">{strings.display.stepped}</ToggleButton>
          <ToggleButton value="continuous">{strings.display.continuous}</ToggleButton>
        </ToggleButtonGroup>
      </Row>
      <WaterLegend palette={display.waterDepthPalette} />
      <FormControlLabel
        control={
          <Switch
            checked={display.showFlowVectors}
            onChange={(_, checked) => setDisplay({ showFlowVectors: checked })}
          />
        }
        label={strings.panel.showWaterFlow}
      />
      <FormControlLabel
        control={
          <Switch checked={layers.flow} onChange={(_, checked) => setLayer({ flow: checked })} />
        }
        label={strings.panel.showFlow}
      />
      <Row label={strings.panel.flowSpacing}>
        <ToggleButtonGroup
          size="small"
          exclusive
          aria-label={strings.panel.flowSpacing}
          value={display.flowVectorSpacingM}
          onChange={(_, value: Display['flowVectorSpacingM'] | null) => {
            if (value !== null) setDisplay({ flowVectorSpacingM: value })
          }}
        >
          {ARROW_SPACINGS.map((m) => (
            <ToggleButton key={m} value={m}>
              {m} m
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Row>
      <FormControlLabel
        control={
          <Switch
            checked={layers.elevation}
            onChange={(_, checked) => setLayer({ elevation: checked })}
          />
        }
        label={strings.panel.showElevation}
      />
      <FormControlLabel
        control={
          <Switch
            checked={layers.depressions}
            onChange={(_, checked) => setLayer({ depressions: checked })}
          />
        }
        label={strings.panel.showDepressions}
      />
      <DepressionLegend />
    </>
  )
}
