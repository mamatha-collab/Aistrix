import Application from '../application'

export const metadata = { robots: { index: false, follow: false } }

// Keep workspace state and its navigation guards alive across private routes.
// Each page verifies the session; the layout never serves privileged data.
export default function WorkspaceLayout({ children }) {
  return <Application>{children}</Application>
}
