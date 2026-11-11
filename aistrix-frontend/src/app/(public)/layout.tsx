import type { ChildrenProps } from '../../types/domain'
import PublicRuntime from './runtime'

export default function PublicLayout({ children }: ChildrenProps) {
  return <><PublicRuntime />{children}</>
}
