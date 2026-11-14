import type { Level } from '@/model/types'

/** Body and rings when everything is fine: quiet, neutral. */
export const NEUTRAL = '#8fa3b8'

/** Status colors. Used only where something needs attention. */
export const LEVEL_COLOR: Record<Level, string> = {
  nominal: '#6fcf97',
  unreliable: '#7b8593',
  caution: '#f2a93b',
  danger: '#ff5a5a',
  offline: '#7b8593',
}

/** Color for a body part: neutral while nominal, status color otherwise. */
export const partColor = (level: Level) => (level === 'nominal' ? NEUTRAL : LEVEL_COLOR[level])

export const LEVEL_WORD: Record<Level, string> = {
  nominal: 'Nominal',
  unreliable: 'Check sensor',
  caution: 'Caution',
  danger: 'Warning',
  offline: 'No signal',
}
