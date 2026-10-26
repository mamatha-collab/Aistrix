import { describe, expect, it } from 'vitest'
import { disposeDiffEditor } from './diffEditorLifecycle'

describe('diff editor ownership', () => {
  it('detaches and disposes the widget before releasing its text models', () => {
    const calls = []
    let attached = true
    const model = label => ({
      isDisposed: () => false,
      dispose: () => {
        if (attached) throw new Error('TextModel got disposed before DiffEditorWidget model got reset')
        calls.push(label)
      },
    })
    const editor = {
      setModel: value => { expect(value).toBeNull(); attached = false; calls.push('detach') },
      dispose: () => calls.push('editor'),
    }
    disposeDiffEditor(editor, { original: model('original'), modified: model('modified') })
    expect(calls).toEqual(['detach', 'editor', 'original', 'modified'])
  })

  it('releases partially created models if initialization fails', () => {
    let disposed = 0
    disposeDiffEditor(null, { original: { isDisposed: () => false, dispose: () => disposed++ } })
    expect(disposed).toBe(1)
  })

  it('does not dispose already released or duplicate models twice', () => {
    let disposed = false
    let releases = 0
    const model = { isDisposed: () => disposed, dispose: () => { disposed = true; releases++ } }
    disposeDiffEditor(null, { original: model, modified: model })
    disposeDiffEditor(null, { original: model, modified: model })
    expect(disposed).toBe(true)
    expect(releases).toBe(1)
  })
})
