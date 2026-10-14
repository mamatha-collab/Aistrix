import { useState, useEffect, useRef, Suspense } from 'react'
import { track, EVENTS } from '../../lib/analytics'
import { downloadReport, designReport } from '../../lib/reports'
import { supabase } from '../../supabase'
import { useToast } from '../../hooks/useToast'
import ToolsEditor from '../../components/ToolsEditor'
import BillingModeHint from '../../components/BillingModeHint'
import { getRelease } from '../../lib/release'
import { PROVIDER_STYLE, modelOptions, providerById, useProviders } from '../../lib/providers'
import ConfirmDialog from '../../components/ConfirmDialog'
import SafeCard from '../../components/SafeCard'
import { ALL_FIELD_TYPES, AppEmojiWithType, COMMON_SECRET_TEMPLATES, DEV_PHASES, EMPTY_BP, MODEL_HINTS, PromptStudio, RUNTIME_TYPES, appOutputTypeFor, calcReadiness, estimateMonthlyCost, getDevPhase, getInputSchemaFields, getOutputSchemaFields, inputsToSchema, invalidInputFields, isMissingBlueprintTable, migrateBlueprint, mismatchLabel, moduleIds, normalizeDeployment, outputContractMismatch, outputRulesSatisfied, readinessChecks, validInputFields } from './shared'


// ─── Tab: Design — Aistrix Blueprint Studio ──────────────────────────────────

const INPUT_TYPES = ['short_text','long_text','number','select','multi_select','file','image','audio','video','document','url','date','boolean','json','csv']

const OUTPUT_FORMATS = [
  { id: 'markdown',  label: 'Markdown report' },
  { id: 'json',      label: 'JSON object' },
  { id: 'table',     label: 'Table' },
  { id: 'email',     label: 'Email draft' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'decision',  label: 'Decision memo' },
  { id: 'document',  label: 'Multi-section document' },
]

const AI_PRESETS = [
  { id: 'business_analyst',    label: 'Business analyst',    hint: 'Analytical, structured, data-driven. Uses tables and numbered findings.' },
  { id: 'recruiting_assistant',label: 'Recruiting assistant',hint: 'Objective, concise. Scores candidates and provides clear recommendations.' },
  { id: 'sales_operator',      label: 'Sales operator',      hint: 'Persuasive but accurate. Surfaces opportunities and objections clearly.' },
  { id: 'support_triage',      label: 'Support triage',      hint: 'Empathetic, efficient. Categorises issues and suggests resolutions.' },
  { id: 'research_analyst',    label: 'Research analyst',    hint: 'Thorough, cited, impartial. Synthesises sources into clear summaries.' },
  { id: 'legal_admin',         label: 'Legal admin',         hint: 'Precise, cautious. Flags risks and avoids giving legal advice.' },
  { id: 'developer_assistant', label: 'Developer assistant', hint: 'Technical, direct. Writes correct code and explains reasoning.' },
]

// Recursive Zod code-gen
function schemaToZod(fields = [], indent = 0) {
  const pad = '  '.repeat(indent)
  const lines = fields.map(f => {
    const fieldName = f.field || f.name
    if (!fieldName) return ''
    let zodType
    switch (f.type) {
      case 'string':       zodType = 'z.string()'; break
      case 'number':       zodType = 'z.number()'; break
      case 'boolean':      zodType = 'z.boolean()'; break
      case 'string_array': zodType = 'z.array(z.string())'; break
      case 'number_array': zodType = 'z.array(z.number())'; break
      case 'enum':
        zodType = f.enum_values?.length
          ? `z.enum([${f.enum_values.map(v => JSON.stringify(v)).join(', ')}])`
          : 'z.string()'
        break
      case 'object': {
        if (f.nested_fields?.length) {
          const inner = schemaToZod(f.nested_fields, indent + 1)
          zodType = `z.object({\n${inner}\n${pad}  })`
        } else {
          zodType = 'z.record(z.unknown())'
        }
        break
      }
      default: zodType = 'z.unknown()'
    }
    if (f.required === false) zodType += '.optional()'
    const comment = f.description ? `  // ${f.description}` : ''
    return `${pad}  ${fieldName}: ${zodType},${comment}`
  }).filter(Boolean)
  return lines.join('\n')
}

function buildZodExport(inputFields, outputFields) {
  const inputBody  = schemaToZod(inputFields)
  const outputBody = schemaToZod(outputFields)
  return `import { z } from "zod"\n\nexport const InputSchema = z.object({\n${inputBody}\n})\n\nexport const OutputSchema = z.object({\n${outputBody}\n})\n\nexport type Input  = z.infer<typeof InputSchema>\nexport type Output = z.infer<typeof OutputSchema>`
}

// Recursive TypeScript interface gen
function schemaToTs(fields = [], indent = 0) {
  const pad = '  '.repeat(indent)
  return fields.map(f => {
    const fieldName = f.field || f.name
    if (!fieldName) return ''
    let tsType
    switch (f.type) {
      case 'string':       tsType = 'string'; break
      case 'number':       tsType = 'number'; break
      case 'boolean':      tsType = 'boolean'; break
      case 'string_array': tsType = 'string[]'; break
      case 'number_array': tsType = 'number[]'; break
      case 'enum':
        tsType = f.enum_values?.length ? f.enum_values.map(v => `"${v}"`).join(' | ') : 'string'
        break
      case 'object':
        if (f.nested_fields?.length) {
          tsType = `{\n${schemaToTs(f.nested_fields, indent + 1)}\n${pad}  }`
        } else {
          tsType = 'Record<string, unknown>'
        }
        break
      default: tsType = 'unknown'
    }
    const opt = f.required === false ? '?' : ''
    const comment = f.description ? `  // ${f.description}` : ''
    return `${pad}  ${fieldName}${opt}: ${tsType};${comment}`
  }).filter(Boolean).join('\n')
}

function buildTsExport(inputFields, outputFields) {
  return `export interface Input {\n${schemaToTs(inputFields)}\n}\n\nexport interface Output {\n${schemaToTs(outputFields)}\n}`
}

function schemaToJsonSchema(fields = []) {
  const properties = {}
  const required = []
  fields.forEach(f => {
    const fieldName = f?.field || f?.name
    if (!fieldName) return
    let prop
    switch (f.type) {
      case 'number':
        prop = { type: 'number' }
        break
      case 'boolean':
        prop = { type: 'boolean' }
        break
      case 'string_array':
        prop = { type: 'array', items: { type: 'string' } }
        break
      case 'number_array':
        prop = { type: 'array', items: { type: 'number' } }
        break
      case 'enum':
        prop = f.enum_values?.length ? { type: 'string', enum: f.enum_values } : { type: 'string' }
        break
      case 'object':
        prop = f.nested_fields?.length
          ? schemaToJsonSchema(f.nested_fields)
          : { type: 'object', additionalProperties: true }
        break
      default:
        prop = { type: 'string' }
    }
    if (f.description) prop.description = f.description
    properties[fieldName] = prop
    if (f.required !== false) required.push(fieldName)
  })
  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length ? { required } : {}),
  }
}

function buildJsonSchemaExport(inputFields, outputFields) {
  return JSON.stringify({
    input_schema: schemaToJsonSchema(inputFields),
    output_schema: schemaToJsonSchema(outputFields),
  }, null, 2)
}

const PRODUCTION_MODULES = [
  {
    id: 'topic_input',
    name: 'Topic/Input App',
    icon: '⌨️',
    group: 'Input',
    what: 'Collects topic, keyword, language, duration, style, and output format.',
    tech: ['Form schema', 'presets', 'validation'],
    aistrix: 'available',
    effort: 'Now',
  },
  {
    id: 'script_generator',
    name: 'Script Generator',
    icon: '✍️',
    group: 'AI brain',
    what: 'Generates or rewrites the short-video script.',
    tech: ['LLM prompt', 'model selector', 'structured output'],
    aistrix: 'available',
    effort: 'Now',
  },
  {
    id: 'scene_planner',
    name: 'Scene Planner',
    icon: '🎬',
    group: 'AI brain',
    what: 'Splits the script into scenes, shots, keywords, and timing.',
    tech: ['JSON schema', 'agent step', 'workflow step'],
    aistrix: 'partial',
    effort: 'Easy',
  },
  {
    id: 'stock_media',
    name: 'Stock Media Search',
    icon: '🖼️',
    group: 'Media',
    what: 'Finds footage/images from providers like Pexels, Pixabay, or Coverr.',
    tech: ['API connectors', 'thumbnail gallery', 'license metadata'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'ai_video',
    name: 'AI Video Generator',
    icon: '🎞️',
    group: 'Media',
    what: 'Creates new video clips from scene prompts.',
    tech: ['async API polling', 'job status', 'object storage'],
    aistrix: 'missing',
    effort: 'Medium-hard',
  },
  {
    id: 'ai_image',
    name: 'AI Image Generator',
    icon: '🌄',
    group: 'Media',
    what: 'Creates images and optionally animates them into clips.',
    tech: ['image API', 'file storage', 'image-to-video step'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'uploaded_media',
    name: 'Uploaded Media',
    icon: '📁',
    group: 'Media',
    what: 'Lets users provide their own images, video, audio, and files.',
    tech: ['file upload', 'object storage', 'preview', 'permissions'],
    aistrix: 'partial',
    effort: 'High priority',
  },
  {
    id: 'tts',
    name: 'Voiceover/TTS',
    icon: '🎙️',
    group: 'Audio',
    what: 'Turns script text into narration.',
    tech: ['TTS connectors', 'voice picker', 'audio preview'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'voice_preview',
    name: 'Voice Preview',
    icon: '🔊',
    group: 'Audio',
    what: 'Lets users audition voices before running a full job.',
    tech: ['voice catalog', 'sample generation', 'audio player'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'subtitles',
    name: 'Subtitle Generator',
    icon: '💬',
    group: 'Captions',
    what: 'Creates timed captions from script or audio.',
    tech: ['Whisper/API transcription', 'timestamps', 'SRT/VTT output'],
    aistrix: 'missing',
    effort: 'Medium-hard',
  },
  {
    id: 'subtitle_style',
    name: 'Subtitle Style Editor',
    icon: '🎨',
    group: 'Captions',
    what: 'Controls subtitle font, size, color, outline, and position.',
    tech: ['caption style UI', 'ASS/SRT/VTT renderer', 'preview'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'music',
    name: 'Background Music',
    icon: '🎵',
    group: 'Audio',
    what: 'Adds random, uploaded, or AI-generated music with volume control.',
    tech: ['audio library', 'music API', 'mixing'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'video_composer',
    name: 'Video Composer',
    icon: '🧵',
    group: 'Render',
    what: 'Combines clips, voiceover, subtitles, and music into one video.',
    tech: ['FFmpeg', 'MoviePy/Remotion', 'worker runtime'],
    aistrix: 'missing',
    effort: 'Hard',
  },
  {
    id: 'render_job',
    name: 'Render Job Runner',
    icon: '⏳',
    group: 'Runtime',
    what: 'Runs slow generation jobs with progress, retries, and cancellation.',
    tech: ['queue', 'workers', 'status events', 'timeouts'],
    aistrix: 'partial',
    effort: 'High priority',
  },
  {
    id: 'export',
    name: 'Video Export',
    icon: '📤',
    group: 'Output',
    what: 'Exports 9:16, 16:9, or 1:1 final videos.',
    tech: ['render profiles', 'storage', 'download links'],
    aistrix: 'missing',
    effort: 'Medium-hard',
  },
  {
    id: 'batch',
    name: 'Batch Variants',
    icon: '🔁',
    group: 'Runtime',
    what: 'Generates multiple variants and compares outputs.',
    tech: ['batch queue', 'variant metadata', 'comparison UI'],
    aistrix: 'partial',
    effort: 'Medium',
  },
  {
    id: 'task_history',
    name: 'Task History',
    icon: '🕓',
    group: 'Operate',
    what: 'Shows prior jobs, outputs, settings, and failures.',
    tech: ['run history', 'output records', 'file metadata'],
    aistrix: 'partial',
    effort: 'Easy-medium',
  },
  {
    id: 'api_keys',
    name: 'Settings/API Keys',
    icon: '🔐',
    group: 'Operate',
    what: 'Stores provider keys for models, media, TTS, and publishing.',
    tech: ['secrets vault', 'provider config', 'BYOK'],
    aistrix: 'partial',
    effort: 'Medium',
  },
  {
    id: 'preset_import',
    name: 'Preset Import/Export',
    icon: '🧾',
    group: 'Operate',
    what: 'Imports or exports generation settings safely.',
    tech: ['JSON config', 'secret redaction', 'preset versioning'],
    aistrix: 'missing',
    effort: 'Easy-medium',
  },
  {
    id: 'webui',
    name: 'Hosted WebUI',
    icon: '🖥️',
    group: 'Runtime',
    what: 'Hosts a full external WebUI inside Aistrix.',
    tech: ['reverse proxy', 'auth wrapper', 'sandbox routing'],
    aistrix: 'missing',
    effort: 'Hard',
  },
  {
    id: 'api_service',
    name: 'API Service',
    icon: '🔌',
    group: 'Runtime',
    what: 'Exposes generation through authenticated API endpoints.',
    tech: ['API gateway', 'rate limits', 'job endpoint'],
    aistrix: 'partial',
    effort: 'Medium',
  },
  {
    id: 'cli',
    name: 'CLI App Wrapper',
    icon: '⌘',
    group: 'Runtime',
    what: 'Maps form inputs to command-line args and captures outputs.',
    tech: ['command wrapper', 'arg mapper', 'output capture'],
    aistrix: 'missing',
    effort: 'Medium',
  },
  {
    id: 'container',
    name: 'Docker/Container App',
    icon: '📦',
    group: 'Runtime',
    what: 'Runs a full GitHub app without local install.',
    tech: ['Docker build', 'env vars', 'ports', 'logs', 'scale-to-zero'],
    aistrix: 'missing',
    effort: 'Hard',
  },
  {
    id: 'publisher',
    name: 'Social Publisher',
    icon: '🚀',
    group: 'Publish',
    what: 'Publishes finished videos to YouTube Shorts, TikTok, or Instagram.',
    tech: ['OAuth', 'social APIs', 'publish queue', 'scheduler'],
    aistrix: 'missing',
    effort: 'Later',
  },
]

const SHORT_VIDEO_MODULE_TEMPLATE = [
  'topic_input', 'script_generator', 'scene_planner', 'stock_media', 'uploaded_media',
  'tts', 'voice_preview', 'subtitles', 'subtitle_style', 'music', 'video_composer',
  'render_job', 'export', 'batch', 'task_history', 'api_keys',
]

function moduleStatus(module) {
  if (module.aistrix === 'available') return { label: 'Available', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' }
  if (module.aistrix === 'partial') return { label: 'Partial', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20' }
  return { label: 'Needed', cls: 'bg-slate-500/10 text-slate-400 border-white/10' }
}

function yamlValue(value, indent = 0) {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return value.map(v => `${pad}- ${typeof v === 'object' && v !== null ? `\n${yamlObject(v, indent + 1)}` : scalarYaml(v)}`).join('\n')
  }
  if (typeof value === 'object' && value !== null) return `\n${yamlObject(value, indent + 1)}`
  return scalarYaml(value)
}

function scalarYaml(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (value === null || value === undefined || value === '') return '""'
  return JSON.stringify(String(value))
}

function yamlObject(obj = {}, indent = 0) {
  const pad = '  '.repeat(indent)
  return Object.entries(obj).map(([key, value]) => `${pad}${key}: ${yamlValue(value, indent)}`).join('\n')
}

function buildAistrixManifest(app, bp) {
  const deployment = normalizeDeployment(bp.deployment, app)
  return {
    name: app.name,
    app_id: app.id,
    runtime: {
      type: deployment.runtime_type,
      entrypoint: deployment.entrypoint || undefined,
      command: deployment.command || undefined,
      port: deployment.port || undefined,
    },
    resources: {
      cpu: deployment.cpu,
      memory_mb: Number(deployment.memory_mb || 0),
      gpu: !!deployment.gpu,
      scale_to_zero: !!deployment.scale_to_zero,
    },
    jobs: {
      mode: deployment.job_mode,
      timeout_seconds: Number(deployment.timeout_seconds || 0),
    },
    storage: deployment.storage,
    secrets: deployment.secrets.map(s => ({ key: s.key, provider: s.provider || '', required: s.required !== false })),
    inputs: bp.inputs || [],
    outputs: deployment.outputs,
    production_modules: moduleIds(bp.production_modules || []),
  }
}

// serverProblems: the server's publish check on the last saved version
// (null while loading). Shown under the bar so Design never says "ready"
// when publishing would be blocked.
function ReadinessBar({ app, bp, serverProblems }) {
  const checks = readinessChecks(app, bp)
  const score  = calcReadiness(app, bp)
  const color = score >= 100 ? '#00B894' : score >= 60 ? '#FDCB6E' : '#E84393'
  const label = score >= 100 ? 'Ready to test and publish' : score >= 60 ? 'Almost there' : 'Incomplete'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white">Design Readiness</span>
        <span className="text-xs font-bold" style={{ color }}>{score}/100 — {label}</span>
      </div>
      <div className="h-2 bg-[#0E1424] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, background: color }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
        {checks.map(({ key, label, ok }) => (
          <div key={key} className="flex items-center gap-1">
            <span className={`text-xs ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{ok ? '✓' : '○'}</span>
            <span className={`text-xs ${ok ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
          </div>
        ))}
      </div>
      {serverProblems && (
        <p className={`text-[11px] pt-1 ${serverProblems.length ? 'text-amber-300/90' : 'text-emerald-400/90'}`}>
          {serverProblems.length
            ? `Publish check on the saved version: ${serverProblems.length} to fix — ${serverProblems.join(' · ')}`
            : 'Publish check on the saved version: all design checks pass'}
        </p>
      )}
    </div>
  )
}

// Design → Test handoff card
function DesignTestHandoff({ app, bp, isDirty, saving, onSave, onGoToTest, serverProblems }) {
  const oc = bp?.output_contract || {}
  const validInputs = validInputFields(bp)
  const invalidInputs = invalidInputFields(bp)
  const hasFormatRules = outputRulesSatisfied(app, oc)
  const mismatch = outputContractMismatch(app, bp)

  const items = [
    {
      ok: validInputs.length > 0 && invalidInputs.length === 0,
      label: invalidInputs.length > 0
        ? `${invalidInputs.length} input field${invalidInputs.length !== 1 ? 's' : ''} need key + label`
        : `${validInputs.length} valid input field${validInputs.length !== 1 ? 's' : ''} defined`,
    },
    {
      ok: hasFormatRules && !mismatch,
      label: mismatch
        ? mismatchLabel(mismatch)
        : oc.format ? `Output contract: ${oc.format}${hasFormatRules ? ' ✓' : ' — rules missing'}` : 'No output format chosen',
    },
    { ok: !!app?.system_prompt?.trim(),label: app?.system_prompt?.trim() ? 'System prompt written' : 'System prompt missing' },
    { ok: bp?.ai_behavior?.fallback_behavior?.trim(), label: bp?.ai_behavior?.fallback_behavior?.trim() ? 'Fallback behavior set' : 'No fallback behavior defined' },
  ]
  const ready = items.filter(i => i.ok).length
  const total = items.length
  const allGood = ready === total

  return (
    <div className={`border rounded-2xl p-5 space-y-3 ${allGood ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-[#171B33] border-white/5'}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-white uppercase tracking-wider">Design → Test readiness</p>
        <span className={`text-xs font-bold ${allGood ? 'text-emerald-400' : 'text-slate-500'}`}>{ready}/{total} ready</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`text-sm shrink-0 mt-px ${item.ok ? 'text-emerald-400' : 'text-red-400'}`}>{item.ok ? '✓' : '○'}</span>
            <span className={`text-xs min-w-0 break-words ${item.ok ? 'text-slate-300' : 'text-slate-500'}`}>{item.label}</span>
          </div>
        ))}
      </div>
      {allGood && serverProblems?.length > 0 && (
        <p className="text-[11px] text-amber-300/90 leading-relaxed">
          You can test now. Before publishing, also fix: {serverProblems.join(' · ')}
        </p>
      )}
      {allGood && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-emerald-400">
            {isDirty ? 'All checks passed — save before generating tests.' : 'All checks passed — generate blueprint tests next.'}
          </p>
          {isDirty ? (
            <button onClick={onSave} disabled={saving}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/25 transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save before testing'}
            </button>
          ) : (
            <button onClick={onGoToTest}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/25 transition-colors">
              Generate tests →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ProductionModulePlanner({ app, bp, setBp }) {
  const selectedIds = moduleIds(bp.production_modules || [])
  const selected = new Set(selectedIds)
  const selectedModules = PRODUCTION_MODULES.filter(m => selected.has(m.id))
  const missing = selectedModules.filter(m => m.aistrix === 'missing')
  const partial = selectedModules.filter(m => m.aistrix === 'partial')
  const available = selectedModules.filter(m => m.aistrix === 'available')
  const groups = [...new Set(PRODUCTION_MODULES.map(m => m.group))]

  function toggle(id) {
    const next = selected.has(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id]
    setBp({ ...bp, production_modules: next })
  }

  function applyShortVideoTemplate() {
    const modules = [...new Set([...selectedIds, ...SHORT_VIDEO_MODULE_TEMPLATE])]
    const existingInputs = bp.inputs || []
    const existingKeys = new Set(existingInputs.map(f => f.key))
    const recommendedInputs = [
      { key: 'topic', label: 'Video topic or keyword', type: 'short_text', required: true, pii: false, placeholder: 'e.g. 5 ways AI helps real estate agents' },
      { key: 'language', label: 'Language', type: 'select', required: true, pii: false, options: ['English', 'Spanish', 'Hindi'], placeholder: 'English' },
      { key: 'aspect_ratio', label: 'Aspect ratio', type: 'select', required: true, pii: false, options: ['9:16', '16:9', '1:1'], placeholder: '9:16' },
      { key: 'voice_style', label: 'Voice style', type: 'short_text', required: false, pii: false, placeholder: 'Energetic, calm, documentary, sales' },
      { key: 'source_media', label: 'Optional uploaded media', type: 'file', required: false, pii: false, placeholder: 'Upload images, clips, or audio' },
    ].filter(f => !existingKeys.has(f.key))
    const inputs = [...existingInputs, ...recommendedInputs]
    const outputFields = [
      { field: 'status', type: 'enum', required: true, description: 'Job status', enum_values: ['queued', 'running', 'completed', 'failed'] },
      { field: 'video_url', type: 'string', required: true, description: 'Final rendered video URL' },
      { field: 'subtitles_url', type: 'string', required: false, description: 'Caption file URL when generated' },
      { field: 'metadata', type: 'object', required: false, description: 'Render metadata', nested_fields: [
        { field: 'duration_seconds', type: 'number', required: false, description: 'Final video duration' },
        { field: 'aspect_ratio', type: 'string', required: false, description: 'Rendered aspect ratio' },
        { field: 'estimated_cost_usd', type: 'number', required: false, description: 'Estimated generation cost' },
      ] },
    ]
    setBp({
      ...bp,
      business_problem: bp.business_problem || 'Generate short-form marketing or social videos from a topic without requiring local video-production software.',
      audience: bp.audience || 'Creators, marketers, agencies, recruiters, realtors, and small businesses that need repeatable short-video production.',
      inputs,
      input_schema: { ...(bp.input_schema || {}), type: 'object', fields: inputsToSchema(inputs) },
      output_schema: { ...(bp.output_schema || {}), type: 'object', fields: outputFields },
      output_contract: { ...(bp.output_contract || {}), format: 'json', fields: outputFields },
      permissions: { ...(bp.permissions || {}), requires_external_api: true, stores_user_data: true },
      production_modules: modules,
      deployment: normalizeDeployment({
        ...(bp.deployment || {}),
        runtime_type: 'media',
        job_mode: 'async',
        timeout_seconds: 900,
        cpu: '2',
        memory_mb: 4096,
        gpu: false,
        storage: { input_files: true, output_files: true, persistent: true, retention_days: 30 },
        outputs: [
          { path: 'final_video.mp4', type: 'video', required: true },
          { path: 'captions.srt', type: 'subtitle', required: false },
        ],
        secrets: [
          { key: 'OPENAI_API_KEY', label: 'OpenAI API key', provider: 'OpenAI', required: true },
          { key: 'PEXELS_API_KEY', label: 'Pexels API key', provider: 'Pexels', required: false },
          { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API key', provider: 'ElevenLabs', required: false },
        ],
        cost: { estimated_model_usd: 0.08, estimated_runtime_usd: 0.12, estimated_storage_usd: 0.01 },
      }, app),
    })
  }

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-white uppercase tracking-wider">Production Modules</p>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            Design compound AI apps as smaller modules: script, media, voice, subtitles, render jobs, container runtime, and publishing.
          </p>
        </div>
        <button onClick={applyShortVideoTemplate}
          className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors shrink-0">
          Apply short-video template
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-3">
          <p className="text-lg font-bold text-emerald-300">{available.length}</p>
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Available now</p>
        </div>
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-3">
          <p className="text-lg font-bold text-amber-300">{partial.length}</p>
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Partial in Aistrix</p>
        </div>
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-3">
          <p className="text-lg font-bold text-slate-300">{missing.length}</p>
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Needs platform work</p>
        </div>
      </div>

      <div className="space-y-4">
        {groups.map(group => (
          <div key={group} className="space-y-2">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{group}</p>
            <div className="grid md:grid-cols-2 gap-2">
              {PRODUCTION_MODULES.filter(m => m.group === group).map(m => {
                const active = selected.has(m.id)
                const status = moduleStatus(m)
                return (
                  <button key={m.id} onClick={() => toggle(m.id)}
                    className={`text-left rounded-xl border p-3 transition-all ${active ? 'bg-[#6C5CE7]/10 border-[#6C5CE7]/35' : 'bg-[#0E1424] border-white/5 hover:border-white/15'}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-lg shrink-0">{m.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-white">{m.name}</p>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${status.cls}`}>{status.label}</span>
                          <span className="text-[9px] text-slate-600">{m.effort}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{m.what}</p>
                        <p className="text-[10px] text-slate-600 mt-1">{m.tech.join(' · ')}</p>
                      </div>
                      <span className={`text-sm shrink-0 ${active ? 'text-[#A29BFE]' : 'text-slate-700'}`}>{active ? '✓' : '○'}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {selectedModules.length > 0 && (
        <div className="bg-[#0A0E1A] border border-white/5 rounded-xl p-4 space-y-2">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Selected technical plan</p>
          <div className="flex flex-wrap gap-2">
            {selectedModules.map(m => {
              const status = moduleStatus(m)
              return (
                <span key={m.id} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${status.cls}`}>
                  {m.icon} {m.name}
                </span>
              )
            })}
          </div>
          {missing.length > 0 && (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              This design needs new Aistrix platform primitives before full production: {missing.map(m => m.name).join(', ')}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DeploymentBlueprintPanel({ app, bp, setBp }) {
  const deployment = normalizeDeployment(bp.deployment, app)
  const [manifestTab, setManifestTab] = useState('yaml')
  const [copied, setCopied] = useState(false)
  const estimate = estimateMonthlyCost(deployment, 1000)
  const manifest = buildAistrixManifest(app, { ...bp, deployment })
  const manifestText = manifestTab === 'json'
    ? JSON.stringify(manifest, null, 2)
    : yamlObject(manifest)

  function updateDeployment(patch) {
    setBp({ ...bp, deployment: normalizeDeployment({ ...deployment, ...patch }, app) })
  }
  function updateStorage(patch) {
    updateDeployment({ storage: { ...deployment.storage, ...patch } })
  }
  function updateCost(patch) {
    updateDeployment({ cost: { ...deployment.cost, ...patch } })
  }
  function addSecret(template = {}) {
    const existing = new Set((deployment.secrets || []).map(s => s.key))
    const next = template.key && !existing.has(template.key)
      ? template
      : { key: '', label: '', provider: '', required: true }
    updateDeployment({ secrets: [...deployment.secrets, next] })
  }
  function updateSecret(i, patch) {
    updateDeployment({ secrets: deployment.secrets.map((s, idx) => idx === i ? { ...s, ...patch } : s) })
  }
  function removeSecret(i) {
    updateDeployment({ secrets: deployment.secrets.filter((_, idx) => idx !== i) })
  }
  function addOutput() {
    updateDeployment({ outputs: [...deployment.outputs, { path: '', type: 'file', required: true }] })
  }
  function updateOutput(i, patch) {
    updateDeployment({ outputs: deployment.outputs.map((o, idx) => idx === i ? { ...o, ...patch } : o) })
  }
  function removeOutput(i) {
    updateDeployment({ outputs: deployment.outputs.filter((_, idx) => idx !== i) })
  }
  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(manifestText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }
  function downloadManifest() {
    const ext = manifestTab === 'json' ? 'json' : 'yaml'
    const blob = new Blob([manifestText], { type: manifestTab === 'json' ? 'application/json' : 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aistrix.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-white uppercase tracking-wider">Deployment Blueprint</p>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            Define how this app will run after Design: runtime, jobs, files, secrets, resources, and deploy manifest.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-slate-500 uppercase font-semibold">Estimated cost</p>
          <p className="text-sm font-bold text-white">${estimate.perRun.toFixed(3)} / run</p>
          <p className="text-[10px] text-slate-500">${estimate.monthly.toFixed(0)} / 1k runs</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Runtime type</p>
        <div className="grid md:grid-cols-3 gap-2">
          {RUNTIME_TYPES.map(rt => {
            const active = deployment.runtime_type === rt.id
            return (
              <button key={rt.id} onClick={() => updateDeployment({ runtime_type: rt.id })}
                className={`text-left rounded-xl border p-3 transition-all ${active ? 'bg-[#6C5CE7]/10 border-[#6C5CE7]/40' : 'bg-[#0E1424] border-white/5 hover:border-white/15'}`}>
                <p className={`text-xs font-semibold ${active ? 'text-[#A29BFE]' : 'text-white'}`}>{rt.label}</p>
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{rt.desc}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Runtime details</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Entrypoint</label>
              <input value={deployment.entrypoint || ''} onChange={e => updateDeployment({ entrypoint: e.target.value })}
                placeholder="app/main.py or index.js"
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Port</label>
              <input value={deployment.port || ''} onChange={e => updateDeployment({ port: e.target.value })}
                placeholder="8000"
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[9px] text-slate-600 uppercase font-semibold">Command</label>
            <input value={deployment.command || ''} onChange={e => updateDeployment({ command: e.target.value })}
              placeholder="uv run python main.py --topic {{topic}}"
              className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Job mode</label>
              <select value={deployment.job_mode} onChange={e => updateDeployment({ job_mode: e.target.value })}
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40">
                <option value="sync">sync</option>
                <option value="async">async</option>
                <option value="scheduled">scheduled</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Timeout seconds</label>
              <input type="number" min="1" value={deployment.timeout_seconds || 0} onChange={e => updateDeployment({ timeout_seconds: Number(e.target.value) })}
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
            </div>
          </div>
        </div>

        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Resources & storage</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">CPU</label>
              <input value={deployment.cpu || '1'} onChange={e => updateDeployment({ cpu: e.target.value })}
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] text-slate-600 uppercase font-semibold">Memory MB</label>
              <input type="number" min="128" value={deployment.memory_mb || 1024} onChange={e => updateDeployment({ memory_mb: Number(e.target.value) })}
                className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
            </div>
            <label className="flex items-end gap-2 pb-1.5 cursor-pointer">
              <input type="checkbox" checked={!!deployment.gpu} onChange={e => updateDeployment({ gpu: e.target.checked })}
                className="w-3 h-3 accent-[#6C5CE7]" />
              <span className="text-[10px] text-slate-400">GPU</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['input_files', 'Input files'],
              ['output_files', 'Output files'],
              ['persistent', 'Persistent storage'],
              ['scale_to_zero', 'Scale to zero'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer bg-[#171B33] border border-white/5 rounded-lg px-3 py-2">
                <input type="checkbox"
                  checked={key === 'scale_to_zero' ? !!deployment.scale_to_zero : !!deployment.storage?.[key]}
                  onChange={e => key === 'scale_to_zero' ? updateDeployment({ scale_to_zero: e.target.checked }) : updateStorage({ [key]: e.target.checked })}
                  className="w-3 h-3 accent-[#6C5CE7]" />
                <span className="text-[10px] text-slate-400">{label}</span>
              </label>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-[9px] text-slate-600 uppercase font-semibold">Retention days</label>
            <input type="number" min="1" value={deployment.storage?.retention_days || 30} onChange={e => updateStorage({ retention_days: Number(e.target.value) })}
              className="w-32 bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Required secrets</p>
            <button onClick={() => addSecret()} className="text-[10px] text-[#A29BFE] hover:text-white transition-colors">+ Add secret</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_SECRET_TEMPLATES.map(t => (
              <button key={t.key} onClick={() => addSecret(t)}
                className="text-[10px] px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 transition-colors">
                {t.key}
              </button>
            ))}
          </div>
          {!deployment.secrets.length ? (
            <p className="text-[11px] text-slate-500 py-2">No secrets required yet.</p>
          ) : (
            <div className="space-y-2">
              {deployment.secrets.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                  <input value={s.key || ''} onChange={e => updateSecret(i, { key: e.target.value.replace(/\s+/g, '_').toUpperCase() })}
                    placeholder="API_KEY"
                    className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none font-mono" />
                  <input value={s.provider || ''} onChange={e => updateSecret(i, { provider: e.target.value })}
                    placeholder="Provider"
                    className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none" />
                  <label className="flex items-center gap-1 text-[10px] text-slate-500">
                    <input type="checkbox" checked={s.required !== false} onChange={e => updateSecret(i, { required: e.target.checked })}
                      className="w-3 h-3 accent-[#6C5CE7]" />
                    Required
                  </label>
                  <button aria-label="Remove" onClick={() => removeSecret(i)} className="text-slate-600 hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Output files</p>
            <button onClick={addOutput} className="text-[10px] text-[#A29BFE] hover:text-white transition-colors">+ Add output</button>
          </div>
          {!deployment.outputs.length ? (
            <p className="text-[11px] text-slate-500 py-2">No output files declared. Prompt-only apps may not need this.</p>
          ) : (
            <div className="space-y-2">
              {deployment.outputs.map((o, i) => (
                <div key={i} className="grid grid-cols-[1fr_110px_auto_auto] gap-2 items-center">
                  <input value={o.path || ''} onChange={e => updateOutput(i, { path: e.target.value })}
                    placeholder="final_video.mp4"
                    className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none font-mono" />
                  <select value={o.type || 'file'} onChange={e => updateOutput(i, { type: e.target.value })}
                    className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none">
                    {['file','json','image','audio','video','subtitle','document'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500">
                    <input type="checkbox" checked={o.required !== false} onChange={e => updateOutput(i, { required: e.target.checked })}
                      className="w-3 h-3 accent-[#6C5CE7]" />
                    Required
                  </label>
                  <button aria-label="Remove" onClick={() => removeOutput(i)} className="text-slate-600 hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#0A0E1A] border border-[#6C5CE7]/15 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] text-[#A29BFE] uppercase font-bold tracking-wider">Aistrix manifest</p>
            <p className="text-[11px] text-slate-500">Portable deployment definition generated from this Design blueprint.</p>
          </div>
          <div className="flex items-center gap-2">
            {['yaml','json'].map(t => (
              <button key={t} onClick={() => setManifestTab(t)}
                className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${manifestTab === t ? 'bg-[#6C5CE7]/20 text-[#A29BFE]' : 'text-slate-600 hover:text-slate-400'}`}>
                {t.toUpperCase()}
              </button>
            ))}
            <button onClick={copyManifest} className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors font-semibold">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={downloadManifest} className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors font-semibold">
              Export
            </button>
          </div>
        </div>
        <pre className="text-[10px] font-mono text-slate-400 overflow-x-auto leading-relaxed max-h-72 whitespace-pre">{manifestText}</pre>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ['Model/API', 'estimated_model_usd'],
          ['Runtime', 'estimated_runtime_usd'],
          ['Storage', 'estimated_storage_usd'],
        ].map(([label, key]) => (
          <div key={key} className="bg-[#0E1424] border border-white/5 rounded-xl p-3 space-y-1">
            <label className="text-[9px] text-slate-600 uppercase font-semibold">{label} cost/run</label>
            <input type="number" min="0" step="0.001" value={deployment.cost?.[key] ?? 0}
              onChange={e => updateCost({ [key]: Number(e.target.value) })}
              className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Reusable comma-separated list editor for format rules
function FormatRulesEditor({ label, hint, rulesKey, bp, setBp }) {
  const val = bp.output_contract?.format_rules?.[rulesKey] || ''
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{label}</label>
      <input value={val}
        onChange={e => setBp({ ...bp, output_contract: { ...bp.output_contract, format_rules: { ...(bp.output_contract?.format_rules || {}), [rulesKey]: e.target.value } } })}
        placeholder={hint}
        className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
      <p className="text-[10px] text-slate-400">Comma-separated values</p>
    </div>
  )
}

const APP_BLUEPRINTS_SQL = `-- Aistrix Developer Studio: App Blueprints
-- Run this in the Supabase SQL editor, then refresh the app.

create table if not exists public.app_blueprints (
  app_id uuid primary key references public.apps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  blueprint jsonb not null default '{}'::jsonb,
  readiness_score integer not null default 0 check (readiness_score >= 0 and readiness_score <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_blueprints_user_id_idx
  on public.app_blueprints(user_id);

alter table public.app_blueprints enable row level security;

drop policy if exists "Developers can read own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can insert own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can update own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can delete own app blueprints" on public.app_blueprints;

create policy "Developers can read own app blueprints"
  on public.app_blueprints
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can insert own app blueprints"
  on public.app_blueprints
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can update own app blueprints"
  on public.app_blueprints
  for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can delete own app blueprints"
  on public.app_blueprints
  for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );`

function BlueprintEditor({ app, user, onAppUpdated, onOpenPromptStudio, onGoToTest }) {
  const toast   = useToast()
  const [bp, setBp]           = useState(null)   // null = loading
  const [savedBp, setSavedBp] = useState(null)
  const [, setBpProd]         = useState(null)   // last promoted snapshot
  const [tableNeeded, setTableNeeded] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [savingModel, setSavingModel] = useState(false)
  const providers = useProviders()
  const [freeRunsDraft, setFreeRunsDraft] = useState(app.free_runs_per_user_day ?? '')
  const [copilot, setCopilot] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copilotOutput, setCopilotOutput] = useState('')
  const [copilotSuggestions, setCopilotSuggestions] = useState(null)
  const [serverProblems, setServerProblems] = useState(null)
  const [exporting, setExporting] = useState(false)
  // When the saved design was last written, as loaded: if it changes before
  // we save, someone else (or another tab) saved in between.
  const savedAtRef = useRef(null)
  const [conflict, setConflict] = useState(null)   // { at, byMe } — someone else saved since we loaded
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  useEffect(() => { loadBlueprint(); loadServerChecks() }, [app.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // The server's publish checks (not tests: those belong to the Test step).
  function loadServerChecks() {
    getRelease(app.id).then(r => setServerProblems(r.checks || [])).catch(() => setServerProblems(null))
  }

  async function loadBlueprint() {
    const { data, error } = await supabase.from('app_blueprints')
      .select('blueprint, blueprint_prod, updated_at').eq('app_id', app.id).maybeSingle()
    if (error?.code === '42703' || error?.message?.includes('blueprint_prod')) {
      // blueprint_prod column not added yet — fall back to blueprint only
      const { data: d2, error: e2 } = await supabase.from('app_blueprints')
        .select('blueprint, updated_at').eq('app_id', app.id).maybeSingle()
      savedAtRef.current = d2?.updated_at || null
      if (isMissingBlueprintTable(e2)) { setTableNeeded(true); return }
      const raw2 = d2?.blueprint ? { ...EMPTY_BP, ...d2.blueprint } : { ...EMPTY_BP }
      const next2 = migrateBlueprint(raw2)
      setBp(next2); setSavedBp(next2)
      return
    }
    if (isMissingBlueprintTable(error)) { setTableNeeded(true); return }
    savedAtRef.current = data?.updated_at || null
    const raw  = data?.blueprint ? { ...EMPTY_BP, ...data.blueprint } : { ...EMPTY_BP }
    const next = migrateBlueprint(raw)
    setBp(next)
    setSavedBp(next)
    if (data?.blueprint_prod) setBpProd(migrateBlueprint({ ...EMPTY_BP, ...data.blueprint_prod }))
  }

  async function save(next, { force = false } = {}) {
    setSaving(true)
    if (!force && savedAtRef.current) {
      const { data: current } = await supabase.from('app_blueprints').select('updated_at, user_id').eq('app_id', app.id).maybeSingle()
      if (current?.updated_at && new Date(current.updated_at).getTime() !== new Date(savedAtRef.current).getTime()) {
        setSaving(false)
        setConflict({ at: current.updated_at, byMe: current.user_id === user.id })
        return false
      }
    }
    const normalized = migrateBlueprint(next)
    const score = calcReadiness(app, normalized)
    const savedAt = new Date().toISOString()
    const { error } = await supabase.from('app_blueprints').upsert(
      { app_id: app.id, user_id: user.id, blueprint: normalized, readiness_score: score, updated_at: savedAt },
      { onConflict: 'app_id' }
    )
    if (!error) savedAtRef.current = savedAt
    if (!error && app.is_published) {
      const { error: dcErr } = await supabase.from('apps').update({ has_draft_changes: true }).eq('id', app.id)
      if (!dcErr) onAppUpdated?.({ ...app, has_draft_changes: true })
    }
    setSaving(false)
    if (isMissingBlueprintTable(error)) {
      setTableNeeded(true)
      toast('Blueprint table is not set up yet', 'error')
      return false
    }
    if (error) { toast(error.message, 'error'); return false }
    setBp(normalized)
    setSavedBp(normalized)
    toast('Blueprint saved', 'success', 2000)
    track(EVENTS.BUILD_DESIGN_SAVED, { app_id: app.id, readiness: score, overwrote_newer: force })
    loadServerChecks()
    return true
  }

  function update(patch) {
    setBp(p => ({ ...p, ...patch }))
  }

  async function updateAppModel(patch) {
    const nextProvider = patch.ai_provider || app.ai_provider || 'claude'
    const firstModel = providerById(providers, nextProvider).default_model || modelOptions(providers, nextProvider)[0]?.id
    const next = {
      ai_provider: nextProvider,
      ai_model: patch.ai_model || (patch.ai_provider ? firstModel : app.ai_model || firstModel),
    }
    setSavingModel(true)
    const { error } = await supabase.from('apps').update(next).eq('id', app.id)
    setSavingModel(false)
    if (error) { toast(error.message, 'error'); return }
    onAppUpdated?.({ ...app, ...next })
    toast('Model settings saved', 'success', 2000)
    loadServerChecks()
  }

  // Picking a Design output format also sets what the app actually returns.
  async function chooseOutputFormat(format) {
    setBp({ ...bp, output_contract: { ...bp.output_contract, format } })
    const outputType = appOutputTypeFor(format, app.output_type)
    if (outputType === app.output_type) return
    const { error } = await supabase.from('apps').update({ output_type: outputType }).eq('id', app.id)
    if (error) { toast(error.message, 'error'); return }
    onAppUpdated?.({ ...app, output_type: outputType })
  }

  // Who pays when end users run the app (see BillingModeHint).
  async function updateBilling(patch) {
    setSavingModel(true)
    const { error } = await supabase.from('apps').update(patch).eq('id', app.id)
    setSavingModel(false)
    if (error) { toast(error.message, 'error'); return }
    onAppUpdated?.({ ...app, ...patch })
    toast('Billing settings saved', 'success', 2000)
  }

  // ── Input schema helpers ──
  function addInput() {
    const inputs = [...(bp.inputs || []), { key: '', label: '', type: 'short_text', required: true, pii: false, placeholder: '' }]
    setBp({ ...bp, inputs, input_schema: { ...(bp.input_schema || {}), type: 'object', fields: inputsToSchema(inputs) } })
  }
  function updateInput(i, patch) {
    const inputs = bp.inputs.map((f, idx) => idx === i ? { ...f, ...patch } : f)
    setBp({ ...bp, inputs, input_schema: { ...(bp.input_schema || {}), type: 'object', fields: inputsToSchema(inputs) } })
  }
  function removeInput(i) {
    const inputs = bp.inputs.filter((_, idx) => idx !== i)
    setBp({ ...bp, inputs, input_schema: { ...(bp.input_schema || {}), type: 'object', fields: inputsToSchema(inputs) } })
  }

  // ── Output schema helpers ──
  function ocFields() { return getOutputSchemaFields(bp) }
  function setOcFields(fields) {
    setBp({
      ...bp,
      output_schema: { ...(bp.output_schema || {}), type: 'object', fields },
      output_contract: { ...bp.output_contract, fields },
    })
  }
  function addField() { setOcFields([...ocFields(), { field: '', type: 'string', description: '', required: true }]) }
  function updateField(i, patch) { setOcFields(ocFields().map((f, idx) => idx === i ? { ...f, ...patch } : f)) }
  function removeField(i) { setOcFields(ocFields().filter((_, idx) => idx !== i)) }
  function addNestedField(i) {
    const f = ocFields()[i]
    updateField(i, { nested_fields: [...(f.nested_fields || []), { field: '', type: 'string', description: '', required: true }] })
  }
  function updateNestedField(i, j, patch) {
    const f = ocFields()[i]
    updateField(i, { nested_fields: f.nested_fields.map((nf, idx) => idx === j ? { ...nf, ...patch } : nf) })
  }
  function removeNestedField(i, j) {
    const f = ocFields()[i]
    updateField(i, { nested_fields: f.nested_fields.filter((_, idx) => idx !== j) })
  }

  // ── Copilot ──
  async function generateBlueprint() {
    if (!copilot.trim()) return
    setGenerating(true)
    setCopilotOutput('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const systemPrompt = `You are an AI app design assistant for the Aistrix platform. Given a developer's app idea, return a JSON blueprint with these exact keys: business_problem, audience, inputs (array of {key, label, type, required, pii}), input_schema ({type:"object", fields:[{field,type,required,description,enum_values?}]}), output_contract ({format, fields: [{field, type, required, description, enum_values?, nested_fields?}]}), output_schema ({type:"object", fields:[{field,type,required,description,enum_values?,nested_fields?}]}), production_modules (array of ids from this list when relevant: ${PRODUCTION_MODULES.map(m => m.id).join(', ')}), system_prompt_hint, marketplace_tagline. Be concise and practical. Return ONLY valid JSON, no markdown fences.`
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ app_id: null, input: copilot, system_prompt: systemPrompt, ai_provider: 'claude', ai_model: null }),
      })
      if (!res.ok) throw new Error('Copilot request failed')
      const reader = res.body.getReader(); const decoder = new TextDecoder()
      let buf = ''; let raw = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try { const d = JSON.parse(line.slice(6)); if (d.token) { raw += d.token; setCopilotOutput(raw) } } catch {}
        }
      }
      // Try to parse and apply
      try {
        const parsed = JSON.parse(raw.trim())
        const next = {
          ...bp,
          business_problem: parsed.business_problem || bp.business_problem,
          audience:          parsed.audience          || bp.audience,
          inputs:            parsed.inputs?.length    ? parsed.inputs : bp.inputs,
          input_schema:      parsed.input_schema      || bp.input_schema,
          output_contract:   parsed.output_contract   || bp.output_contract,
          output_schema:     parsed.output_schema     || bp.output_schema,
          production_modules: parsed.production_modules?.length ? moduleIds(parsed.production_modules) : bp.production_modules,
        }
        setBp(migrateBlueprint(next))
        // Surface extra suggestions (not auto-applied)
        const extras = {}
        if (parsed.system_prompt_hint)  extras.system_prompt_hint  = parsed.system_prompt_hint
        if (parsed.marketplace_tagline) extras.marketplace_tagline = parsed.marketplace_tagline
        if (Object.keys(extras).length) setCopilotSuggestions(extras)
        toast('Blueprint generated — review and save', 'success', 4000)
      } catch {
        toast('Generated — copy from preview below', 'info', 3000)
      }
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  if (tableNeeded) return (
    <div className="bg-[#171B33] border border-amber-500/20 rounded-2xl p-6 space-y-3">
      <p className="text-amber-300 font-semibold text-sm">⚠️ Blueprint table not set up</p>
      <p className="text-slate-300 text-xs leading-relaxed">
        The frontend can read and write blueprints after the table exists, but it cannot create Supabase tables with the public anon key.
        Apply the database migrations (<code className="bg-[#0E1424] px-1.5 py-0.5 rounded text-amber-300">npm run db:push</code>) to enable the Blueprint Studio.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(APP_BLUEPRINTS_SQL)
            toast('Blueprint SQL copied', 'success', 2000)
          }}
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors"
        >
          Copy SQL
        </button>
        <button onClick={loadBlueprint} className="text-xs font-semibold px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors">
          Retry after running SQL
        </button>
      </div>
      <details className="text-[10px] text-slate-500">
        <summary className="cursor-pointer hover:text-slate-300">Preview SQL</summary>
        <pre className="mt-2 max-h-64 overflow-auto bg-[#0E1424] border border-white/5 rounded-xl p-3 text-slate-400 whitespace-pre-wrap">{APP_BLUEPRINTS_SQL}</pre>
      </details>
    </div>
  )

  if (!bp) return <p className="text-slate-500 text-sm py-6 text-center">Loading blueprint…</p>

  const isDirty = !!savedBp && JSON.stringify(bp) !== JSON.stringify(savedBp)
  const mismatch = outputContractMismatch(app, bp)
  const invalidInputs = invalidInputFields(bp)
  const openPromptStudio = () => onOpenPromptStudio(app)

  async function downloadPdf() {
    setExporting(true)
    try {
      await downloadReport(designReport(app, bp, { checks: readinessChecks(app, bp), score: calcReadiness(app, bp), serverProblems, unsaved: isDirty }))
    } catch (e) {
      toast(`Couldn't create the PDF: ${e.message}`, 'error', 6000)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      {conflict && (
        <ConfirmDialog
          title="This design changed since you opened it"
          subtitle={`${app.emoji || ''} ${app.name}`.trim()}
          confirmLabel="Save mine anyway" busyLabel="Saving…" danger
          onCancel={() => setConflict(null)}
          onConfirm={async () => { await save(bp, { force: true }); setConflict(null) }}>
          {conflict.byMe ? 'You saved it in another tab or window' : 'A teammate saved it'} at {new Date(conflict.at).toLocaleTimeString()}.
          Saving now replaces those changes with yours.
          <button type="button" onClick={async () => { setConflict(null); await loadBlueprint(); loadServerChecks() }}
            className="block mt-2 text-[11px] font-semibold text-[#A29BFE] hover:text-white">
            Load their version instead (your unsaved edits are discarded) →
          </button>
        </ConfirmDialog>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: (app.color || '#6C5CE7') + '33' }}>
            <AppEmojiWithType app={app} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-white font-semibold text-sm">{app.name}</p>
            </div>
            <p className="text-[10px] text-slate-500">Edit inputs, output contract, prompt behavior, and permissions</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[10px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
              Unsaved changes
            </span>
          )}
          <button onClick={downloadPdf} disabled={exporting} title="Download this design as a PDF"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors disabled:opacity-40 whitespace-nowrap">
            {exporting ? 'Preparing…' : '⬇ PDF report'}
          </button>
          <button onClick={openPromptStudio}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
            ✏️ Prompt Studio
          </button>
          <button onClick={() => save(bp)} disabled={saving}
            className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
            {saving ? 'Saving…' : 'Save blueprint'}
          </button>
        </div>
      </div>

      {/* Readiness */}
      <SafeCard name="Readiness">{() => (
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5">
        <ReadinessBar app={app} bp={bp} serverProblems={serverProblems} />
      </div>
      )}</SafeCard>

      {(mismatch || invalidInputs.length > 0) && (
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Blueprint validation</p>
          {mismatch?.kind === 'app' && (
            <p className="text-xs text-slate-300">
              This app currently returns <span className="text-amber-200 font-semibold">{mismatch.appFormat === 'json' ? 'JSON' : mismatch.appFormat}</span>, but the output contract is set to <span className="text-amber-200 font-semibold">{mismatch.contractFormat}</span>. Pick the output format again to align them.
            </p>
          )}
          {mismatch && mismatch.kind !== 'app' && (
            <p className="text-xs text-slate-300">
              Your prompt appears to require <span className="text-amber-200 font-semibold">{mismatch.promptFormat}</span>, but the output contract is set to <span className="text-amber-200 font-semibold">{mismatch.contractFormat}</span>. Align these before testing.
            </p>
          )}
          {invalidInputs.length > 0 && (
            <p className="text-xs text-slate-300">
              {invalidInputs.length} input field{invalidInputs.length !== 1 ? 's' : ''} need a valid key, label, and type before Aistrix can generate reliable UI, API params, and tests.
            </p>
          )}
        </div>
      )}

      {/* Copilot */}
      <SafeCard name="Blueprint copilot">{() => (
      <div className="bg-[#171B33] border border-[#6C5CE7]/20 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-semibold text-[#A29BFE] uppercase tracking-wider">✦ Aistrix Copilot</p>
        <p className="text-[11px] text-slate-300">Describe your app idea and Copilot will fill the blueprint for you.</p>
        <div className="flex gap-2">
          <input value={copilot} onChange={e => setCopilot(e.target.value)}
            placeholder="e.g. An AI app that screens resumes for recruiters…"
            className="flex-1 bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40"
            onKeyDown={e => e.key === 'Enter' && generateBlueprint()}
          />
          <button onClick={generateBlueprint} disabled={!copilot.trim() || generating}
            className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40 shrink-0">
            {generating ? '…' : 'Generate →'}
          </button>
        </div>
        {copilotOutput && !generating && (
          <details className="text-[10px] text-slate-400">
            <summary className="cursor-pointer hover:text-slate-400">View raw output</summary>
            <pre className="mt-2 bg-[#0E1424] rounded-lg p-3 overflow-x-auto text-slate-300 leading-relaxed whitespace-pre-wrap">{copilotOutput}</pre>
          </details>
        )}
        {copilotSuggestions && (
          <div className="bg-[#0E1424] border border-[#6C5CE7]/20 rounded-xl p-4 space-y-2">
            <p className="text-[10px] font-semibold text-[#A29BFE] uppercase tracking-wider">Copilot suggestions — review before applying</p>
            {copilotSuggestions.system_prompt_hint && (
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">Prompt hint</p>
                <p className="text-xs text-slate-300 leading-relaxed">{copilotSuggestions.system_prompt_hint}</p>
                <button onClick={openPromptStudio} className="text-[11px] text-[#A29BFE] hover:underline">Apply in Prompt Studio →</button>
              </div>
            )}
            {copilotSuggestions.marketplace_tagline && (
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">Marketplace tagline</p>
                <p className="text-xs text-slate-300">{copilotSuggestions.marketplace_tagline}</p>
                <p className="text-[10px] text-slate-400">Use this when submitting to the Marketplace.</p>
              </div>
            )}
            <button onClick={() => setCopilotSuggestions(null)} className="text-[10px] text-slate-400 hover:text-slate-400 transition-colors">Dismiss</button>
          </div>
        )}
      </div>
      )}</SafeCard>

      {/* Input Schema */}
      <SafeCard name="Input schema">{() => (
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-white uppercase tracking-wider">Input Schema</p>
          <button onClick={addInput}
            className="text-xs font-semibold px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors">
            + Add field
          </button>
        </div>
        {!bp.inputs?.length ? (
          <p className="text-[11px] text-slate-400 text-center py-3">No inputs defined yet. Add fields to auto-generate the app UI, API params, and test cases.</p>
        ) : (
          <div className="space-y-2">
            {bp.inputs.map((field, i) => (
              <div key={i} className="bg-[#0E1424] border border-white/5 rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-[9px] text-slate-600 uppercase font-semibold">Key</label>
                    <input value={field.key} onChange={e => updateInput(i, { key: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                      placeholder="job_description"
                      className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 font-mono" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[9px] text-slate-600 uppercase font-semibold">Label</label>
                    <input value={field.label} onChange={e => updateInput(i, { label: e.target.value })}
                      placeholder="Job Description"
                      className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[9px] text-slate-600 uppercase font-semibold">Type</label>
                    <select value={field.type} onChange={e => updateInput(i, { type: e.target.value })}
                      className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#6C5CE7]/40">
                      {INPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex items-center gap-1.5 pb-1.5">
                      <input type="checkbox" id={`req-${i}`} checked={field.required} onChange={e => updateInput(i, { required: e.target.checked })}
                        className="w-3 h-3 accent-[#6C5CE7]" />
                      <label htmlFor={`req-${i}`} className="text-[10px] text-slate-400">Required</label>
                    </div>
                    <div className="flex items-center gap-1.5 pb-1.5">
                      <input type="checkbox" id={`pii-${i}`} checked={field.pii} onChange={e => updateInput(i, { pii: e.target.checked })}
                        className="w-3 h-3 accent-amber-500" />
                      <label htmlFor={`pii-${i}`} className="text-[10px] text-slate-400">PII</label>
                    </div>
                    <button aria-label="Remove" onClick={() => removeInput(i)} className="text-slate-600 hover:text-red-400 transition-colors text-xs pb-1.5 ml-auto">✕</button>
                  </div>
                </div>
                <input value={field.placeholder || ''} onChange={e => updateInput(i, { placeholder: e.target.value })}
                  placeholder="Placeholder hint for this field…"
                  className="w-full bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
              </div>
            ))}
          </div>
        )}
      </div>
      )}</SafeCard>

      {/* Output Contract */}
      <SafeCard name="Output contract">{() => (
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-white uppercase tracking-wider">Output Contract</p>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Output format</label>
          <div className="flex flex-wrap gap-2">
            {OUTPUT_FORMATS.map(f => (
              <button key={f.id} onClick={() => chooseOutputFormat(f.id)}
                className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${bp.output_contract?.format === f.id ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#A29BFE]' : 'bg-white/3 border-white/8 text-slate-500 hover:text-white hover:border-white/20'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* JSON: output schema fields */}
        {bp.output_contract?.format === 'json' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Output schema</label>
              <button onClick={addField}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors">
                + Add field
              </button>
            </div>
            {!ocFields().length ? (
              <p className="text-[11px] text-slate-400 text-center py-2">No fields — add at least one for schema validation.</p>
            ) : (
              <div className="space-y-1.5">
                {ocFields().map((f, i) => (
                  <SchemaFieldRow key={i}
                    f={f} depth={0}
                    onChange={patch => updateField(i, patch)}
                    onRemove={() => removeField(i)}
                    onAddNested={() => addNestedField(i)}
                    onChangeNested={(j, patch) => updateNestedField(i, j, patch)}
                    onRemoveNested={j => removeNestedField(i, j)}
                  />
                ))}
              </div>
            )}

            {/* Schema export panel */}
            {ocFields().length > 0 && (
              <SchemaExportPanel inputFields={getInputSchemaFields(bp)} outputFields={getOutputSchemaFields(bp)} />
            )}
          </div>
        )}

        {/* Markdown: required sections */}
        {bp.output_contract?.format === 'markdown' && (
          <FormatRulesEditor
            label="Required sections"
            hint="e.g. Summary, Findings, Recommendations"
            rulesKey="sections"
            bp={bp} setBp={setBp}
          />
        )}

        {/* Table: required columns */}
        {bp.output_contract?.format === 'table' && (
          <FormatRulesEditor
            label="Required columns"
            hint="e.g. Name, Score, Recommendation"
            rulesKey="columns"
            bp={bp} setBp={setBp}
          />
        )}

        {/* Email: subject / tone / required parts */}
        {bp.output_contract?.format === 'email' && (
          <div className="space-y-2">
            {[
              { key: 'subject_hint',  label: 'Subject line hint',  ph: 'e.g. "[Action required] {{topic}}"' },
              { key: 'tone',          label: 'Tone',               ph: 'e.g. Professional and concise' },
              { key: 'required_parts',label: 'Required parts',     ph: 'e.g. Greeting, Context, Ask, Sign-off' },
            ].map(({ key, label, ph }) => (
              <div key={key} className="space-y-0.5">
                <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{label}</label>
                <input value={bp.output_contract?.format_rules?.[key] || ''}
                  onChange={e => setBp({ ...bp, output_contract: { ...bp.output_contract, format_rules: { ...(bp.output_contract.format_rules || {}), [key]: e.target.value } } })}
                  placeholder={ph}
                  className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
              </div>
            ))}
          </div>
        )}

        {/* Checklist: minimum items */}
        {bp.output_contract?.format === 'checklist' && (
          <div className="space-y-2">
            <FormatRulesEditor label="Required item categories" hint="e.g. Completed, Pending, Blocked" rulesKey="categories" bp={bp} setBp={setBp} />
            <div className="space-y-0.5">
              <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Minimum items</label>
              <input type="number" min={1} value={bp.output_contract?.format_rules?.min_items || ''}
                onChange={e => setBp({ ...bp, output_contract: { ...bp.output_contract, format_rules: { ...(bp.output_contract.format_rules || {}), min_items: e.target.value } } })}
                placeholder="e.g. 3"
                className="w-32 bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
            </div>
          </div>
        )}

        {/* Scorecard: score range + required dimensions */}
        {bp.output_contract?.format === 'scorecard' && (
          <div className="space-y-2">
            <FormatRulesEditor label="Scored dimensions" hint="e.g. Relevance, Clarity, Completeness" rulesKey="dimensions" bp={bp} setBp={setBp} />
            <div className="flex gap-3">
              {[['min_score','Min score','0'],['max_score','Max score','100']].map(([key, label, ph]) => (
                <div key={key} className="space-y-0.5 flex-1">
                  <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{label}</label>
                  <input type="number" value={bp.output_contract?.format_rules?.[key] || ''}
                    onChange={e => setBp({ ...bp, output_contract: { ...bp.output_contract, format_rules: { ...(bp.output_contract.format_rules || {}), [key]: e.target.value } } })}
                    placeholder={ph}
                    className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Decision memo: required sections */}
        {bp.output_contract?.format === 'decision' && (
          <FormatRulesEditor label="Required sections" hint="e.g. Context, Options, Recommendation, Risks" rulesKey="sections" bp={bp} setBp={setBp} />
        )}

        {/* Multi-section document */}
        {bp.output_contract?.format === 'document' && (
          <FormatRulesEditor label="Required sections" hint="e.g. Executive Summary, Analysis, Appendix" rulesKey="sections" bp={bp} setBp={setBp} />
        )}
      </div>
      )}</SafeCard>

      {/* AI Behavior */}
      <SafeCard name="AI behavior">{() => (
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-white uppercase tracking-wider">AI Behavior</p>
          <button onClick={openPromptStudio}
            className="text-[11px] text-[#A29BFE] hover:text-white transition-colors">
            Edit full prompt →
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">AI provider</label>
            <select
              value={app.ai_provider || 'claude'}
              onChange={e => updateAppModel({ ai_provider: e.target.value })}
              disabled={savingModel}
              className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40 disabled:opacity-50">
              {providers.map(p => <option key={p.id} value={p.id}>{PROVIDER_STYLE[p.id]?.name || p.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Model</label>
            <select
              value={app.ai_model || providerById(providers, app.ai_provider || 'claude').default_model || ''}
              onChange={e => updateAppModel({ ai_model: e.target.value })}
              disabled={savingModel}
              className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40 disabled:opacity-50">
              {modelOptions(providers, app.ai_provider || 'claude', app.ai_model).map(m => (
                <option key={m.id} value={m.id}>{m.label}{MODEL_HINTS[m.id] ? ` - ${MODEL_HINTS[m.id]}` : ''}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Who pays for runs</label>
            <select
              value={app.billing_mode || 'free'}
              onChange={e => updateBilling({ billing_mode: e.target.value })}
              disabled={savingModel}
              className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40 disabled:opacity-50">
              <option value="free">Free for users — your key</option>
              <option value="byok">Users bring their own key</option>
            </select>
          </div>
          {(app.billing_mode || 'free') === 'free' && (
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Free runs per user per day</label>
              <input type="number" min="0" placeholder="20"
                value={freeRunsDraft}
                onChange={e => setFreeRunsDraft(e.target.value)}
                onBlur={() => {
                  const next = freeRunsDraft === '' ? null : Math.max(0, Number(freeRunsDraft))
                  if (next !== (app.free_runs_per_user_day ?? null)) updateBilling({ free_runs_per_user_day: next })
                }}
                disabled={savingModel}
                className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7]/40 disabled:opacity-50" />
            </div>
          )}
        </div>
        <BillingModeHint mode={app.billing_mode || 'free'} provider={providerById(providers, app.ai_provider || 'claude')} freeRuns={freeRunsDraft} />
        {(() => {
          const MODEL_COSTS = {
            'gpt-4o': { input: 2.50, output: 10.00 }, 'gpt-4o-mini': { input: 0.15, output: 0.60 },
            'claude-haiku-4-5': { input: 0.80, output: 4.00 }, 'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
            'claude-sonnet-5': { input: 3.00, output: 15.00 }, 'claude-opus-4-5': { input: 15.00, output: 75.00 },
            'claude-opus-5': { input: 15.00, output: 75.00 },
          }
          const model = app.ai_model || 'claude-sonnet-4-5'
          const rates = MODEL_COSTS[model] || Object.entries(MODEL_COSTS).find(([k]) => model.includes(k) || k.includes(model))?.[1]
          if (!rates) return null
          const promptChars = (app.system_prompt || '').length
          const promptTokens = Math.round(promptChars / 4)
          const avgOutput = 300
          const costPerRun = ((promptTokens / 1e6) * rates.input) + ((avgOutput / 1e6) * rates.output)
          const fmt = n => n < 0.001 ? `$${(n * 1000).toFixed(3)}m` : `$${n.toFixed(4)}`
          return (
            <div className="flex items-center gap-3 px-3 py-2 bg-[#0A0F1E] rounded-lg border border-white/5 text-[10px]">
              <span className="text-slate-500">~{promptTokens.toLocaleString()} prompt tokens</span>
              <span className="text-white/10">·</span>
              <span className="text-slate-500">~{avgOutput} avg output</span>
              <span className="text-white/10">·</span>
              <span className="text-green-400 font-semibold">Est. {fmt(costPerRun)} per run</span>
              <span className="text-white/10">·</span>
              <span className="text-slate-600">{fmt(rates.input * 1e-3)}/1K in · {fmt(rates.output * 1e-3)}/1K out</span>
            </div>
          )
        })()}
        <p className="text-[10px] text-slate-400">Model changes affect quality, cost, and test results. Run the Test tab again after switching.</p>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Tone preset</label>
          <div className="flex flex-wrap gap-2">
            {AI_PRESETS.map(p => (
              <button key={p.id}
                onClick={() => update({ ai_behavior: { ...bp.ai_behavior, tone_preset: bp.ai_behavior?.tone_preset === p.id ? '' : p.id } })}
                title={p.hint}
                className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${bp.ai_behavior?.tone_preset === p.id ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-[#A29BFE]' : 'bg-white/3 border-white/8 text-slate-500 hover:text-white hover:border-white/20'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Refusal rules</label>
          <textarea value={bp.ai_behavior?.refusal_rules || ''} onChange={e => update({ ai_behavior: { ...bp.ai_behavior, refusal_rules: e.target.value } })}
            placeholder="e.g. Never give legal advice. Refuse to process resumes without a job description."
            rows={2}
            className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Missing-data fallback</label>
          <input value={bp.ai_behavior?.fallback_behavior || ''} onChange={e => update({ ai_behavior: { ...bp.ai_behavior, fallback_behavior: e.target.value } })}
            placeholder="e.g. Ask for the missing job description before proceeding"
            className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40" />
        </div>
        {app.system_prompt && (
          <div className="bg-[#0E1424] rounded-xl px-3 py-2 border border-white/5">
            <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1">Current system prompt (truncated)</p>
            <p className="text-[11px] text-slate-300 line-clamp-2 font-mono leading-relaxed">{app.system_prompt}</p>
          </div>
        )}
      </div>
      )}</SafeCard>

      {/* Permissions */}
      <SafeCard name="Permissions">{() => (
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-white uppercase tracking-wider">Permissions & Risk</p>
        <div className="space-y-2">
          {[
            { key: 'handles_sensitive_data', label: 'Handles sensitive or PII data',  color: 'amber' },
            { key: 'stores_user_data',        label: 'Stores user data',               color: 'amber' },
            { key: 'requires_external_api',   label: 'Calls external APIs or services',color: 'blue'  },
          ].map(({ key, label, color }) => {
            const on = bp.permissions?.[key]
            return (
              <label key={key} className="flex items-center gap-3 cursor-pointer group">
                <button onClick={() => update({ permissions: { ...bp.permissions, [key]: !on } })}
                  className={`w-9 h-5 rounded-full transition-all shrink-0 relative ${on ? (color === 'amber' ? 'bg-amber-500' : 'bg-blue-500') : 'bg-[#0E1424] border border-white/10'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
                </button>
                <span className={`text-xs ${on ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'} transition-colors`}>{label}</span>
              </label>
            )
          })}
        </div>
      </div>
      )}</SafeCard>

      {/* Tools */}
      <SafeCard name="Tools">{() => (
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-white uppercase tracking-wider">Tools & Capabilities</p>
        <ToolsEditor appId={app.id} />
      </div>
      )}</SafeCard>

      {/* Design → Test handoff */}
      <SafeCard name="Test handoff">
      <DesignTestHandoff
        app={app}
        bp={bp}
        isDirty={isDirty}
        saving={saving}
        onSave={() => save(bp)}
        onGoToTest={() => onGoToTest?.(app.id)}
        serverProblems={serverProblems}
      />
      </SafeCard>

      {/* App planning — collapsed by default */}
      <SafeCard name="App planning">{() => (
      <details className="group">
        <summary className="flex items-center justify-between px-4 py-3 bg-[#171B33] border border-white/5 rounded-2xl cursor-pointer hover:bg-[#1A2040] transition-colors list-none">
          <span className="text-xs font-semibold text-slate-400">App planning <span className="text-slate-600 font-normal">(business context, modules, deployment)</span></span>
          <span className="text-slate-600 text-[10px] group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="mt-2 space-y-4">
          {/* Business Problem */}
          <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
            <p className="text-xs font-bold text-white uppercase tracking-wider">Business Problem</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Problem this app solves</label>
                <textarea value={bp.business_problem} onChange={e => update({ business_problem: e.target.value })} rows={3}
                  placeholder="e.g. Screen resumes against job descriptions quickly and consistently"
                  className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Target audience</label>
                <textarea value={bp.audience} onChange={e => update({ audience: e.target.value })} rows={3}
                  placeholder="e.g. Recruiters and hiring managers at mid-size companies"
                  className="w-full bg-[#0E1424] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]/40 resize-none" />
              </div>
            </div>
          </div>
          {/* Production modules */}
          <ProductionModulePlanner app={app} bp={bp} setBp={setBp} />
          {/* Deployment blueprint */}
          <DeploymentBlueprintPanel app={app} bp={bp} setBp={setBp} />
        </div>
      </details>
      )}</SafeCard>

      {/* Save footer */}
      <div className="flex justify-end pt-2 pb-6">
        <button onClick={() => save(bp)} disabled={saving}
          className="text-sm font-semibold px-6 py-2.5 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
          {saving ? 'Saving…' : 'Save blueprint'}
        </button>
      </div>
    </div>
  )
}

// ─── Schema field row (recursive, supports one level of nesting) ──────────────

function SchemaFieldRow({ f, depth, onChange, onRemove, onAddNested, onChangeNested, onRemoveNested }) {
  const isNested = depth > 0
  function addChild() {
    onChange({ nested_fields: [...(f.nested_fields || []), { field: '', type: 'string', description: '', required: true }] })
  }
  function updateChild(j, patch) {
    onChange({ nested_fields: (f.nested_fields || []).map((nf, idx) => idx === j ? { ...nf, ...patch } : nf) })
  }
  function removeChild(j) {
    onChange({ nested_fields: (f.nested_fields || []).filter((_, idx) => idx !== j) })
  }
  return (
    <div className={`rounded-xl p-2.5 space-y-1.5 ${isNested ? 'bg-[#171B33] border border-white/5 ml-4' : 'bg-[#0E1424] border border-white/5'}`}>
      <div className="grid grid-cols-3 gap-2 items-center">
        <input value={f.field} onChange={e => onChange({ field: e.target.value })}
          placeholder={isNested ? 'nested_key' : 'field_name'}
          className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none font-mono" />
        <select value={f.type} onChange={e => onChange({ type: e.target.value, nested_fields: e.target.value !== 'object' ? undefined : (f.nested_fields || []) })}
          className="bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none">
          {ALL_FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex gap-2 items-center">
          <input value={f.description || ''} onChange={e => onChange({ description: e.target.value })}
            placeholder="Description"
            className="flex-1 bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 placeholder-slate-500 focus:outline-none" />
          <button aria-label="Remove" onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors text-xs shrink-0">✕</button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={f.required !== false} onChange={e => onChange({ required: e.target.checked })}
            className="accent-[#6C5CE7] w-3 h-3" />
          <span className="text-[10px] text-slate-500">Required</span>
        </label>
        {f.type === 'enum' && (
          <div className="flex-1 flex items-center gap-2">
            <span className="text-[10px] text-slate-500 shrink-0">Allowed values</span>
            <input value={(f.enum_values || []).join(', ')}
              onChange={e => onChange({ enum_values: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              placeholder="low, medium, high"
              className="flex-1 bg-[#171B33] border border-white/8 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none font-mono" />
          </div>
        )}
        {f.type === 'object' && (
          <button onClick={onAddNested || addChild}
            className="text-[10px] text-[#A29BFE] hover:text-white transition-colors">
            + Add nested field
          </button>
        )}
      </div>

      {/* Nested fields (one level deep) */}
      {f.type === 'object' && f.nested_fields?.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {f.nested_fields.map((nf, j) => (
            <SchemaFieldRow key={j} f={nf} depth={depth + 1}
              onChange={patch => onChangeNested ? onChangeNested(j, patch) : updateChild(j, patch)}
              onRemove={() => onRemoveNested ? onRemoveNested(j) : removeChild(j)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Schema export panel ───────────────────────────────────────────────────────

function SchemaExportPanel({ inputFields, outputFields }) {
  const [tab, setTab] = useState('zod')
  const [copied, setCopied] = useState(false)

  const code = tab === 'zod'
    ? buildZodExport(inputFields, outputFields)
    : tab === 'typescript'
      ? buildTsExport(inputFields, outputFields)
      : buildJsonSchemaExport(inputFields, outputFields)

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }

  function download() {
    const ext = tab === 'json_schema' ? 'json' : 'ts'
    const blob = new Blob([code], { type: tab === 'json_schema' ? 'application/json' : 'text/typescript' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aistrix-schema.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-[#0A0E1A] border border-[#6C5CE7]/15 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {['zod','typescript','json_schema'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${tab === t ? 'bg-[#6C5CE7]/20 text-[#A29BFE]' : 'text-slate-600 hover:text-slate-400'}`}>
              {t === 'zod' ? 'Zod' : t === 'typescript' ? 'TypeScript' : 'JSON Schema'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copy}
            className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors font-semibold">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button onClick={download}
            className="text-[10px] text-slate-500 hover:text-[#A29BFE] transition-colors font-semibold">
            Export
          </button>
        </div>
      </div>
      <pre className="text-[10px] font-mono text-slate-400 overflow-x-auto leading-relaxed max-h-48 whitespace-pre">{code}</pre>
    </div>
  )
}

// ─── Tab: Design ──────────────────────────────────────────────────────────────

export function DesignTab({ apps, allApps = apps, loading, onOpenCreate, user, onAppUpdated, onGoToTest, selectedAppId, onSelectApp, deployFixReason, phaseByAppId = {} }) {
  const [studioApp, setStudioApp]     = useState(null)

  const app = apps.find(a => a.id === selectedAppId) || apps[0] || null

  useEffect(() => {
    if (studioApp && studioApp.id !== app?.id) setStudioApp(null)
  }, [app?.id, studioApp])

  if (loading) return <p className="text-slate-500 text-sm py-10 text-center">Loading…</p>

  if (!allApps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">🧩</div>
      <p className="text-white font-medium mb-1">No apps yet</p>
      <p className="text-slate-400 text-sm mb-5">Create your first AI app to start building with the Blueprint Studio.</p>
      <button onClick={onOpenCreate}
        className="text-sm font-semibold px-5 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
        + Create app
      </button>
    </div>
  )

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">✏️</div>
      <p className="text-white font-medium mb-1">No apps are in Design</p>
      <p className="text-slate-400 text-sm mb-5">Apps move out of Design when they enter Test or Deploy. Select an app from another phase to move it back here.</p>
      <div className="flex justify-center gap-2 flex-wrap">
        {allApps.map(a => (
          <button key={a.id} onClick={() => onSelectApp?.(a.id)}
            className="text-xs px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors">
            {a.emoji} {a.name} · {DEV_PHASES[getDevPhase(a, phaseByAppId)]?.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <div className="space-y-4">
        {deployFixReason && app?.id === selectedAppId && (
          <div className="bg-[#6C5CE7]/10 border border-[#6C5CE7]/30 rounded-2xl px-4 py-3 flex items-start gap-3">
            <span className="text-[#A29BFE] text-sm mt-0.5">↩</span>
            <div>
              <p className="text-white text-sm font-semibold">Fix publish blocker in Design</p>
              <p className="text-slate-300 text-xs mt-0.5">
                Update {deployFixReason}, save the app, then run the Test tab again before returning to Deploy.
              </p>
            </div>
          </div>
        )}

        {app?.is_published && (
          <div className={`rounded-2xl px-4 py-3 flex items-center justify-between gap-3 ${app.has_draft_changes ? 'bg-amber-500/8 border border-amber-500/20' : 'bg-green-500/8 border border-green-500/20'}`}>
            <div className="flex items-center gap-2">
              <span className={app.has_draft_changes ? 'text-amber-400' : 'text-green-400'}>{app.has_draft_changes ? '⚠' : '●'}</span>
              <div>
                <p className={`text-xs font-semibold ${app.has_draft_changes ? 'text-amber-300' : 'text-green-300'}`}>
                  {app.has_draft_changes ? 'Draft changes — not live yet' : 'Live — no pending changes'}
                </p>
                {app.has_draft_changes && <p className="text-slate-400 text-[11px]">Save, then go to Deploy to promote these changes to production.</p>}
              </div>
            </div>
          </div>
        )}


        {studioApp && (
          <SafeCard name="Prompt Studio" resetKey={studioApp.id}>
          <Suspense fallback={null}>
            <PromptStudio
              mode="inline"
              app={studioApp}
              user={user}
              onClose={() => setStudioApp(null)}
              onSaved={updated => { onAppUpdated?.(updated); setStudioApp(updated) }}
            />
          </Suspense>
          </SafeCard>
        )}

        {app ? (
          <BlueprintEditor
            key={app.id}
            app={app}
            user={user}
            onAppUpdated={onAppUpdated}
            onOpenPromptStudio={a => setStudioApp(a)}
            onGoToTest={onGoToTest}
          />
        ) : (
          <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
            <p className="text-slate-400 text-sm">Select an app above to open its Blueprint Studio.</p>
          </div>
        )}
      </div>
    </>
  )
}
