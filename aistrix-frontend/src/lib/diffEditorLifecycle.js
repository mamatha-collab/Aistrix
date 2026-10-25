// The diff widget subscribes to its models. Detach it before releasing them;
// disposing models first triggers Monaco's disposed-model exception.
export function disposeDiffEditor(editor, models) {
  if (editor) {
    editor.setModel(null)
    editor.dispose()
  }
  for (const model of new Set([models?.original, models?.modified])) {
    if (model && !model.isDisposed()) model.dispose()
  }
}
