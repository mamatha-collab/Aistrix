// One close confirmation for every app builder (all build types and Edit):
// only ask when something was actually entered or changed.
export const DISCARD_MESSAGE = 'Close without saving? Your unsaved app setup will be lost.'

export function confirmDiscard(hasChanges) {
  return !hasChanges || window.confirm(DISCARD_MESSAGE)
}
