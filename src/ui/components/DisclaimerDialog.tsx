import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useStore } from 'zustand'
import type { SettingsStore } from '../../state/settingsStore'
import { strings } from '../strings'

/** 免責表示の状態。初回（未了解）は開き、了解の後はリンクで開き直せる */
export function useDisclaimer(settings: SettingsStore, now: () => Date = () => new Date()) {
  const acknowledgedAt = useStore(settings, (s) => s.disclaimerAcknowledgedAt)
  const [reopened, setReopened] = useState(false)
  return {
    open: acknowledgedAt === null || reopened,
    acknowledged: acknowledgedAt !== null,
    acknowledge: (): void => {
      settings.getState().acknowledgeDisclaimer(now().toISOString())
      setReopened(false)
    },
    close: (): void => setReopened(false),
    reopen: (): void => setReopened(true),
  }
}

interface DialogProps {
  open: boolean
  /** 了解済み。未了解のときは Escape・背景のクリックで閉じない（明示的な了解。tech-spec §9.6） */
  acknowledged: boolean
  onAcknowledge: () => void
  onClose: () => void
}

/** 免責の全文（base-spec §59）。設定で消せない */
export function DisclaimerDialog({ open, acknowledged, onAcknowledge, onClose }: DialogProps) {
  return (
    <Dialog
      open={open}
      aria-labelledby="disclaimer-title"
      // MUI 9 は disableEscapeKeyDown を持たない（Modal からも削られた）。未了解のうちは
      // Escape・背景のクリックのどちらの onClose も無視する（計画で決めたこと 21）
      onClose={() => {
        if (acknowledged) onClose()
      }}
    >
      <DialogTitle id="disclaimer-title">{strings.disclaimer.title}</DialogTitle>
      <DialogContent>
        {strings.disclaimer.lines.map((line) => (
          <Typography key={line} variant="body2" sx={{ mb: 1 }}>
            {line}
          </Typography>
        ))}
        <Typography variant="body2" sx={{ mb: 1 }}>
          {strings.disclaimer.author}
        </Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {strings.disclaimer.sourceCode.label}
          <Link href={strings.disclaimer.sourceCode.url} target="_blank" rel="noopener noreferrer">
            {strings.disclaimer.sourceCode.linkText}
          </Link>
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={acknowledged ? onClose : onAcknowledge}>
          {acknowledged ? strings.disclaimer.close : strings.disclaimer.acknowledge}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** パネルの下端に常に出す短い注意文と、全文へのリンク（tech-spec §9.6 の 2） */
export function DisclaimerNotice({ onShowFull }: { onShowFull: () => void }) {
  return (
    <Box data-testid="disclaimer-notice" sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {strings.disclaimer.notice}
      </Typography>{' '}
      <Link component="button" variant="caption" onClick={onShowFull}>
        {strings.disclaimer.showFull}
      </Link>
    </Box>
  )
}
