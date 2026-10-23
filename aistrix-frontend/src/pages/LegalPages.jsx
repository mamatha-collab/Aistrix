import { Link } from 'react-router-dom'

import { BRAND, SUPPORT_EMAIL } from '../lib/brand'
import { LEGAL } from '../lib/legal'
import { analyticsConfigured, reopenConsent } from '../lib/analytics'
// Draft legal copy written to match how the product actually works (own AI
// keys, review before first publish, refunds and payouts, export/deletion).
// It is not legal advice: fill in src/lib/legal.js and have a lawyer review
// it before a public launch.

function LegalShell({ title, updated, children }) {
  return (
    <div className="min-h-screen bg-[#0F1225] py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="text-sm text-[#6C5CE7] hover:underline">← Back to {BRAND}</Link>
        <h1 className="text-white text-2xl font-bold mt-4 mb-1">{title}</h1>
        <p className="text-slate-500 text-xs mb-8">Last updated: {updated}</p>
        <div className="prose-result text-slate-300 text-sm leading-relaxed space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}

const H = ({ children }) => <h2 className="text-white font-semibold text-base mt-6">{children}</h2>
const Mail = () => <a className="text-[#A29BFE] underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated={LEGAL.updated}>
      <p>
        This policy explains what {LEGAL.company} (&quot;{BRAND}&quot;, &quot;we&quot;) collects when you use {BRAND},
        why, who it&apos;s shared with, and the choices you have. {LEGAL.company} is responsible for your
        account data. When you use an app published by a developer, that developer also decides how the
        app uses what you give it.
      </p>

      <H>What we collect</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Account:</strong> your email address, display name, and sign-in records.</li>
        <li><strong>What you run:</strong> the inputs you give apps, the answers they produce, files and pages you ask
          them to read, and your run history.</li>
        <li><strong>Developer data:</strong> apps you build (prompts, designs, tools, tests, versions), your developer
          profile, Marketplace listings, and sales and payout records.</li>
        <li><strong>Keys and secrets:</strong> AI provider keys and app secrets you save. They&apos;re stored encrypted,
          used only on our servers, and never shown again after saving.</li>
        <li><strong>Usage and diagnostics:</strong> run counts, timings, errors and costs (used for limits, Monitor and
          reliability), and, if enabled, product analytics.</li>
        <li><strong>Feedback:</strong> ratings and comments you give an app&apos;s answers.</li>
      </ul>

      <H>How we use it</H>
      <p>
        To run the apps you choose, operate your account and workspaces, enforce limits, show developers how their
        apps perform, process payments and payouts, send service emails (for example receipts, alerts and review
        decisions), keep {BRAND} secure, and improve it. We don&apos;t sell your personal information and we don&apos;t
        use it for advertising.
      </p>

      <H>What app developers see</H>
      <p>
        Developers see totals for their apps (runs, errors, timings, costs) without who ran them. If you rate an
        answer, the developer sees the rating and your comment. They see your question and the answer only if you
        choose to share them with the feedback. Developers never see your keys or your other apps.
      </p>

      <H>AI providers and other services we use</H>
      <p>
        When an app runs, its input is sent to the AI provider the app uses (Anthropic, OpenAI or Google) to
        produce the answer, using the developer&apos;s or your own API key; that provider handles it under its own
        terms for that key&apos;s account. Other services that process data for us:
      </p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Supabase: database, sign-in and file storage.</li>
        <li>Stripe: payments and developer payouts (we never see full card numbers).</li>
        <li>Resend: email delivery.</li>
        <li>Sentry: error reports (with secrets removed); PostHog: product analytics, if enabled.</li>
        <li>GitHub, SerpAPI and web pages: only when you connect GitHub or an app uses search or reads a page.</li>
        <li>Our hosting provider, which runs the {BRAND} servers.</li>
      </ul>
      <p>
        Data is stored in {LEGAL.dataRegion}. Where it&apos;s processed in another country, we rely on the safeguards
        the law requires, such as standard contractual clauses.
      </p>

      <H>Cookies and browser storage</H>
      <p>
        {BRAND} keeps your sign-in and preferences (such as theme and workspace) in your browser. These are
        needed for the service to work. If product analytics are enabled, they set their own cookies to measure
        how {BRAND} is used, and only after you accept them in the cookie notice. If you decline, no analytics
        cookies are set and nothing is sent.
        {analyticsConfigured && <> <button onClick={reopenConsent} className="text-[#A29BFE] underline">Change your cookie choice</button></>}
      </p>

      <H>How long we keep it</H>
      <p>
        Account and app data are kept while your account exists. Run history and diagnostics are kept as long as
        they&apos;re useful for your history and for Monitor. Sales and payout records are kept for as long as tax and
        accounting law requires, even after an account is deleted (without your name).
      </p>

      <H>Your choices and rights</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>Download everything your account owns: Settings → Your account → Download my data.</li>
        <li>Delete your account: Settings → Your account → Delete account. If something depends on it (a team you
          own, active subscriptions, payouts owed), you&apos;ll be told what to sort out first.</li>
        <li>Remove saved keys, memory and run history from Settings at any time; turn developer alert emails off in
          Settings → Notifications.</li>
        <li>Depending on where you live, you may also have the right to correct your data, object to or restrict
          some uses, and complain to a data protection authority. Contact us to use any of these rights.</li>
      </ul>

      <H>Security</H>
      <p>
        Keys and secrets are encrypted, access is limited by role, and secret values are removed from logs and
        error reports. No service is perfectly secure; tell us right away if you find a problem.
      </p>

      <H>Children</H>
      <p>{BRAND} isn&apos;t meant for anyone under {LEGAL.minimumAge}, and we don&apos;t knowingly collect their data.</p>

      <H>Changes</H>
      <p>We&apos;ll update this page when our practices change and tell you about important changes before they apply.</p>

      <H>Contact</H>
      <p>{LEGAL.company}, {LEGAL.address}. Privacy questions and requests: <Mail /></p>
    </LegalShell>
  )
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated={LEGAL.updated}>
      <p>
        These terms are an agreement between you and {LEGAL.company} (&quot;{BRAND}&quot;, &quot;we&quot;) for using {BRAND}:
        running AI apps, and building, publishing and selling them as a developer. By creating an account you
        accept them. If you use {BRAND} for an organization, you accept them for that organization.
      </p>

      <H>Your account</H>
      <p>
        You must be at least {LEGAL.minimumAge}. Keep your sign-in secure and your details accurate; you&apos;re
        responsible for what happens in your account and in workspaces you manage.
      </p>

      <H>Acceptable use</H>
      <p>Don&apos;t use {BRAND}, or build apps that:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>break the law, or infringe others&apos; rights (including copyright, trademarks and privacy);</li>
        <li>impersonate people or organizations, or mislead people about who made an app;</li>
        <li>produce harmful content (such as harassment, sexual content involving minors, or instructions for
          serious harm), or spread malware, spam or scams;</li>
        <li>collect personal data without a lawful basis and clear notice;</li>
        <li>break the usage policies of the AI provider an app uses;</li>
        <li>get around limits, reviews or security, or overload, probe or reverse-engineer the service.</li>
      </ul>
      <p>We may remove content, unpublish apps or suspend accounts that break these rules.</p>

      <H>AI output</H>
      <p>
        Answers are generated by AI and can be wrong, incomplete or out of date. Check them before relying on
        them, especially for legal, medical, financial or safety decisions.
      </p>

      <H>Developers</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Your own AI keys.</strong> Your apps (building, testing and your customers&apos; runs) use the AI
          provider keys you add. You&apos;re responsible for those accounts, their costs and their terms.</li>
        <li><strong>Plans and limits.</strong> Developer tiers are free and come with limits on apps and test runs,
          shown in Settings → Developer plan. We may change the limits.</li>
        <li><strong>Review.</strong> An app&apos;s first release is reviewed before it goes live. We may approve it, ask
          for changes or decline it, and may unpublish an app that later breaks these terms.</li>
        <li><strong>Your apps and customers.</strong> You&apos;re responsible for your apps, their prompts, tools and
          the services they call, the accuracy of your listings, and how your apps use your customers&apos; data. Use
          customers&apos; information only to provide your app.</li>
        <li><strong>Ownership.</strong> You keep the rights to your apps. You give us the permission we need to host,
          run, review and show them, and to list them if you publish a Marketplace listing.</li>
      </ul>

      <H>Paid apps, refunds and payouts</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>Developers set the price of their apps (from $0.50 a run). Buyers pay through Stripe; {BRAND} keeps a
          platform fee (currently 20%) and pays the rest to the developer&apos;s Stripe account.</li>
        <li>Pay-per-run: each purchase buys one run. A run that fails isn&apos;t used up, so you can try again.
          Subscriptions renew each month until cancelled.</li>
        <li>Refunds: ask the developer or us at <Mail /> within 14 days of a purchase. Unused runs and runs that
          didn&apos;t work as described are refunded; you may also have rights under consumer law that these terms
          don&apos;t limit.</li>
        <li>When a purchase is refunded or charged back, the developer&apos;s share is taken back, including from a
          payout already sent, and a fully refunded unused run is removed.</li>
        <li>Payouts depend on Stripe accepting the developer&apos;s account; Stripe&apos;s terms apply to them. Developers
          are responsible for their own taxes.</li>
      </ul>

      <H>Your content</H>
      <p>
        You keep ownership of what you submit and of what apps generate for you. You give us permission to process
        it to provide {BRAND}. If you share feedback with a developer, they may use it to improve their app.
      </p>

      <H>Our service</H>
      <p>
        We work to keep {BRAND} available and secure but may change, suspend or stop features. {BRAND}&apos;s name,
        software and design belong to {LEGAL.company}.
      </p>

      <H>Ending your use</H>
      <p>
        You can stop at any time and delete your account in Settings. We may suspend or close accounts that break
        these terms or put others at risk, and will tell you why unless the law or security prevents it.
      </p>

      <H>Disclaimers and liability</H>
      <p>
        {BRAND} is provided &quot;as is&quot; and &quot;as available&quot;, without warranties beyond those the law requires. To
        the extent the law allows, we aren&apos;t liable for indirect or consequential losses, and our total liability
        is limited to what you paid us in the 12 months before the claim. Nothing here limits liability that can&apos;t
        be limited by law.
      </p>

      <H>Changes to these terms</H>
      <p>We&apos;ll post changes here and tell you about important ones before they apply. Continuing to use {BRAND} after that means you accept them.</p>

      <H>Law and disputes</H>
      <p>These terms are governed by the law of {LEGAL.jurisdiction}, unless the law where you live gives you other rights.</p>

      <H>Contact</H>
      <p>{LEGAL.company}, {LEGAL.address}. Questions about these terms: <Mail /></p>
    </LegalShell>
  )
}
