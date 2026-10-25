import { useEffect, useRef, useState } from 'react'
import { loader } from '@monaco-editor/react'
import { disposeDiffEditor } from '../lib/diffEditorLifecycle'

// Own anonymous models and the diff widget together. The upstream React
// DiffEditor currently releases models before detaching its widget on unmount.
export default function PromptDiffEditor({ original = '', modified = '', language = 'plaintext', theme = 'vs-dark', options }) {
  const container = useRef(null)
  const instance = useRef(null)
  const current = useRef(null)
  current.current = { original, modified, language, theme, options }
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let editor = null
    let models = null
    const loading = loader.init()
    loading.then(monaco => {
      if (cancelled) return
      const props = current.current
      // No shared paths: this component owns exactly the models it creates.
      models = { original: monaco.editor.createModel(props.original, props.language) }
      models.modified = monaco.editor.createModel(props.modified, props.language)
      editor = monaco.editor.createDiffEditor(container.current, { automaticLayout: true, ...props.options })
      editor.setModel(models)
      monaco.editor.setTheme(props.theme)
      instance.current = { editor, models, monaco }
      setReady(true)
    }).catch(error => {
      if (cancelled || error?.type === 'cancelation') return
      disposeDiffEditor(editor, models)
      editor = null
      models = null
      instance.current = null
      setFailed(true)
    })
    return () => {
      cancelled = true
      loading.cancel()
      instance.current = null
      disposeDiffEditor(editor, models)
    }
  }, [])

  useEffect(() => {
    const live = instance.current
    if (!live) return
    if (live.models.original.getValue() !== original) live.models.original.setValue(original)
    if (live.models.modified.getValue() !== modified) live.models.modified.setValue(modified)
    live.monaco.editor.setModelLanguage(live.models.original, language)
    live.monaco.editor.setModelLanguage(live.models.modified, language)
    live.monaco.editor.setTheme(theme)
    live.editor.updateOptions(options || {})
  }, [original, modified, language, theme, options, ready])

  return (
    <section style={{ height: '100%', width: '100%', position: 'relative' }} aria-label="Prompt comparison">
      {!ready && <div role={failed ? 'alert' : 'status'} className="h-full flex items-center justify-center text-slate-500 text-sm bg-[#0E1424]">
        {failed ? 'The comparison editor could not load. Reopen this section to retry.' : 'Loading editor…'}
      </div>}
      <div ref={container} style={{ height: '100%', width: '100%', display: ready ? 'block' : 'none' }} />
    </section>
  )
}
