import { isValidElement } from 'react'
import type { ColumnOption } from '../core/types'

/**
 * Renders a ColumnOption icon that may be either a ready element (Circle's
 * mock data) or a component type.Keeps the React 18 JSX typing happy, where
 * a bare ReactElement has no call/construct signature.
 */
export function OptionIcon({
  icon,
  className,
}: {
  icon: ColumnOption['icon']
  className?: string
}) {
  if (!icon) return null
  if (isValidElement(icon)) return icon
  const Icon = icon as React.ComponentType<{ className?: string }>
  return <Icon className={className} />
}
