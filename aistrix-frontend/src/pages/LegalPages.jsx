import { Link } from 'react-router-dom'

// Starting-point legal copy so the footer links go somewhere real instead of
// "#". This is template language, not legal advice — have it reviewed by a
// lawyer before relying on it for an actual launch.

function LegalShell({ title, updated, children }) {
  return (
    <div className="min-h-screen bg-[#0F1225] py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="text-sm text-[#6C5CE7] hover:underline">← Back to Aistrix</Link>
        <h1 className="text-white text-2xl font-bold mt-4 mb-1">{title}</h1>
        <p className="text-slate-500 text-xs mb-8">Last updated: {updated}</p>
        <div className="prose-result text-slate-300 text-sm leading-relaxed space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="2026-06-30">
      <p>
        This page explains what information Aistrix collects, how it's used, and the choices
        you have. It's placeholder/template language pending legal review — replace it with
        counsel-approved copy before a public launch.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">What we collect</h2>
      <p>
        Account info (email, display name), the inputs and outputs of apps you run, API keys you
        choose to store (encrypted, never re-displayed in the browser after saving), and basic
        usage data (run counts, timestamps) used for rate limiting and your dashboard.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">How it's used</h2>
      <p>
        To run the AI apps you trigger, to enforce per-account rate limits, to power features you
        opt into (workspace memory, scheduled runs, integrations), and to operate and improve the
        product. We don't sell your data.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">Third parties</h2>
      <p>
        App inputs/outputs are sent to the AI provider you select (Anthropic or OpenAI) to
        generate a response. Payments are processed by Stripe. We don't share your data with
        anyone else except as required by law.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">Your choices</h2>
      <p>
        You can delete stored API keys, workspace memory, and run history from Settings at any
        time. Contact us to request full account deletion.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">Contact</h2>
      <p>Questions about this policy: <a className="text-[#A29BFE] underline" href="mailto:support@aistrix.com">support@aistrix.com</a></p>
    </LegalShell>
  )
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="2026-06-30">
      <p>
        These terms govern your use of Aistrix. This is placeholder/template language pending
        legal review — replace it with counsel-approved copy before a public launch.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">Using Aistrix</h2>
      <p>
        You're responsible for the content of inputs you submit to apps and for complying with
        the underlying AI providers' acceptable use policies. Don't use Aistrix to generate
        illegal content, attempt to abuse rate limits, or reverse-engineer the service.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">Paid apps</h2>
      <p>
        Some apps charge per run via Stripe. Charges are billed at the time of a successful run;
        failed runs are not charged. Refund requests go to support@aistrix.com.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">Your content</h2>
      <p>
        You retain ownership of what you submit and what apps generate for you. By publishing an
        app or workspace to the marketplace, you grant other users a license to run it as
        published.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">No warranty</h2>
      <p>
        Aistrix is provided "as is." AI-generated output can be inaccurate — review it before
        relying on it for important decisions.
      </p>
      <h2 className="text-white font-semibold text-base mt-6">Contact</h2>
      <p>Questions about these terms: <a className="text-[#A29BFE] underline" href="mailto:support@aistrix.com">support@aistrix.com</a></p>
    </LegalShell>
  )
}
