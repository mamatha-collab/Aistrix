export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
export const EMOJIS = ['⚡','🔗','🔄','📋','🧩','🚀','💡','🎯','📈','🛠️','💼','🎓','🔬','✍️','📊']

export const QUICK_START_TEMPLATES = [
  // ── General ──────────────────────────────────────────────────────────────────
  {
    pack: 'General', emoji: '💼', color: '#6C5CE7',
    name: 'Job Application Pipeline',
    desc: 'Resume → Cover Letter → Interview Prep. Output of each step feeds the next.',
    appNames: ['Resume Builder', 'Cover Letter Writer', 'Interview Coach'],
  },
  {
    pack: 'General', emoji: '📝', color: '#6C5CE7',
    name: 'Content Creation',
    desc: 'Research a topic, draft the article, then write a social caption to promote it.',
    appNames: ['Research Assistant', 'Content Writer', 'Social Media Post Generator'],
  },
  {
    pack: 'General', emoji: '📊', color: '#6C5CE7',
    name: 'Market Research',
    desc: 'Research the space, benchmark competitors, then generate a strategic brief.',
    appNames: ['Market Research Assistant', 'Competitor Analysis', 'Executive Summary Generator'],
  },
  {
    pack: 'General', emoji: '🏢', color: '#6C5CE7',
    name: 'Business Proposal',
    desc: 'Outline the opportunity, build the proposal, then craft the pitch summary.',
    appNames: ['Business Plan Builder', 'Business Proposal Writer', 'Executive Summary Generator'],
  },
  // ── Sales ─────────────────────────────────────────────────────────────────────
  {
    pack: 'Sales', emoji: '🎯', color: '#00B894',
    name: 'Lead Qualifier',
    desc: 'Score an inbound lead, write a personalised first-touch email, and log a CRM summary.',
    appNames: ['Lead Qualifier', 'Cold Email Writer', 'CRM Summary Generator'],
  },
  {
    pack: 'Sales', emoji: '📣', color: '#00B894',
    name: 'Outreach Sequence',
    desc: 'Research the prospect, write the cold pitch, then generate a 3-step follow-up sequence.',
    appNames: ['Prospect Researcher', 'Outreach Email Writer', 'Follow-up Email Generator'],
  },
  {
    pack: 'Sales', emoji: '🛡️', color: '#00B894',
    name: 'Objection Handler',
    desc: 'Analyse the objection, draft a confident rebuttal, then recommend the next sales action.',
    appNames: ['Sales Objection Analyzer', 'Rebuttal Writer', 'Next Step Advisor'],
  },
  {
    pack: 'Sales', emoji: '🗂️', color: '#00B894',
    name: 'CRM Deal Summary',
    desc: 'Summarise a call transcript, extract key deal signals, and write a CRM note ready to paste.',
    appNames: ['Call Transcript Analyzer', 'Deal Signal Extractor', 'CRM Summary Generator'],
  },
  // ── HR ────────────────────────────────────────────────────────────────────────
  {
    pack: 'HR', emoji: '📋', color: '#FDCB6E',
    name: 'Resume Screener',
    desc: 'Screen the CV against the job spec, generate interview questions, then draft the offer letter.',
    appNames: ['Resume Screener', 'Interview Question Generator', 'Offer Letter Writer'],
  },
  {
    pack: 'HR', emoji: '❌', color: '#FDCB6E',
    name: 'Rejection & Feedback Draft',
    desc: 'Write a professional, empathetic rejection email with constructive feedback for the candidate.',
    appNames: ['Resume Screener', 'Rejection Email Writer', 'Candidate Feedback Generator'],
  },
  {
    pack: 'HR', emoji: '👋', color: '#FDCB6E',
    name: 'Onboarding Pack',
    desc: 'Write the welcome email, build the 30-day plan, then generate the role description.',
    appNames: ['Welcome Email Generator', 'Onboarding Plan Builder', 'Job Description Writer'],
  },
  {
    pack: 'HR', emoji: '📝', color: '#FDCB6E',
    name: 'Performance Review',
    desc: 'Summarise achievements, draft the review narrative, then suggest development goals.',
    appNames: ['Achievement Summarizer', 'Review Writer', 'Goal Recommendation Generator'],
  },
  // ── Support ───────────────────────────────────────────────────────────────────
  {
    pack: 'Support', emoji: '🎫', color: '#E17055',
    name: 'Ticket Triage',
    desc: 'Classify the ticket by urgency and category, draft a response, then flag escalation risk.',
    appNames: ['Ticket Classifier', 'Support Response Writer', 'Escalation Risk Analyzer'],
  },
  {
    pack: 'Support', emoji: '✍️', color: '#E17055',
    name: 'Response Draft',
    desc: 'Read the customer message, match the tone, and draft a clear, helpful reply in seconds.',
    appNames: ['Customer Message Analyzer', 'Support Response Writer', 'Tone Adjuster'],
  },
  {
    pack: 'Support', emoji: '🚨', color: '#E17055',
    name: 'Escalation Summary',
    desc: 'Summarise a complex support thread into a concise escalation brief for a manager or engineer.',
    appNames: ['Support Thread Summarizer', 'Escalation Summary Generator', 'Priority Classifier'],
  },
  {
    pack: 'Support', emoji: '📚', color: '#E17055',
    name: 'Knowledge Base Builder',
    desc: 'Analyse common questions, generate FAQ answers, then draft the help article.',
    appNames: ['Customer Feedback Analyzer', 'FAQ Generator', 'Help Article Writer'],
  },
  // ── Finance ───────────────────────────────────────────────────────────────────
  {
    pack: 'Finance', emoji: '🧾', color: '#0984E3',
    name: 'Invoice Review',
    desc: 'Check an invoice for errors, categorise each line item, then generate an approval summary.',
    appNames: ['Invoice Reviewer', 'Expense Categorizer', 'Financial Summary Generator'],
  },
  {
    pack: 'Finance', emoji: '📉', color: '#0984E3',
    name: 'Variance Analysis',
    desc: 'Compare actuals vs. budget, identify the top drivers, and write a one-page variance report.',
    appNames: ['Variance Analyzer', 'Root Cause Identifier', 'Financial Report Writer'],
  },
  {
    pack: 'Finance', emoji: '📅', color: '#0984E3',
    name: 'Monthly Close Summary',
    desc: 'Analyse period performance, generate KPI commentary, then write the executive close summary.',
    appNames: ['Financial Data Analyzer', 'KPI Report Generator', 'Executive Summary Generator'],
  },
  {
    pack: 'Finance', emoji: '📊', color: '#0984E3',
    name: 'Budget Narrative',
    desc: 'Turn raw budget numbers into clear management commentary ready for a board pack.',
    appNames: ['Budget Analyzer', 'Management Commentary Writer', 'Executive Summary Generator'],
  },
  // ── Marketing ─────────────────────────────────────────────────────────────────
  {
    pack: 'Marketing', emoji: '📢', color: '#A29BFE',
    name: 'Campaign Builder',
    desc: 'Research the audience, write the campaign brief, then generate ad copy variants.',
    appNames: ['Audience Researcher', 'Campaign Brief Writer', 'Ad Copy Generator'],
  },
  {
    pack: 'Marketing', emoji: '🔍', color: '#A29BFE',
    name: 'SEO Content Engine',
    desc: 'Analyse keyword opportunities, write the long-form SEO post, then generate meta tags.',
    appNames: ['SEO Analyzer', 'Blog Post Writer', 'Meta Tag Generator'],
  },
  {
    pack: 'Marketing', emoji: '♻️', color: '#A29BFE',
    name: 'Content Repurposer',
    desc: 'Take one long-form piece and spin it into email newsletter, tweet thread, and LinkedIn post.',
    appNames: ['Content Summarizer', 'Email Newsletter Writer', 'Social Media Post Generator'],
  },
  {
    pack: 'Marketing', emoji: '🎨', color: '#A29BFE',
    name: 'Brand Voice Pack',
    desc: 'Define the brand tone, rewrite sample copy in that voice, then build a style guide snippet.',
    appNames: ['Brand Voice Analyzer', 'Copy Rewriter', 'Style Guide Generator'],
  },
  // ── Founders ──────────────────────────────────────────────────────────────────
  {
    pack: 'Founders', emoji: '💡', color: '#E84393',
    name: 'Business Idea Validator',
    desc: 'Stress-test the idea against market reality, find the ICP, then write a lean one-pager.',
    appNames: ['Business Idea Validator', 'Market Research Assistant', 'Business Plan Builder'],
  },
  {
    pack: 'Founders', emoji: '📋', color: '#E84393',
    name: 'Proposal Builder',
    desc: 'Outline the opportunity, build a client-ready proposal, then craft the executive summary.',
    appNames: ['Opportunity Analyzer', 'Business Proposal Writer', 'Executive Summary Generator'],
  },
  {
    pack: 'Founders', emoji: '🚀', color: '#E84393',
    name: 'Pitch Writer',
    desc: 'Write the pitch deck narrative, sharpen the value prop, then generate investor FAQs.',
    appNames: ['Pitch Deck Writer', 'Value Proposition Writer', 'Investor FAQ Builder'],
  },
  {
    pack: 'Founders', emoji: '📈', color: '#E84393',
    name: 'GTM Strategy',
    desc: 'Define the go-to-market motion, identify early channels, then write the launch announcement.',
    appNames: ['GTM Strategy Builder', 'Channel Analyzer', 'Launch Announcement Writer'],
  },
]

export const TEMPLATE_PACKS = ['General', 'Sales', 'HR', 'Support', 'Finance', 'Marketing', 'Founders']

export const PACK_COLORS = {
  General: '#6C5CE7', Sales: '#00B894', HR: '#FDCB6E',
  Support: '#E17055', Finance: '#0984E3', Marketing: '#A29BFE', Founders: '#E84393',
}
export const PACK_ICONS = {
  General: '⚡', Sales: '💰', HR: '👥',
  Support: '🎫', Finance: '📊', Marketing: '📢', Founders: '🚀',
}

export const GPT_PROVIDERS = [
  { id: 'claude', label: '🟣 Claude' },
  { id: 'openai', label: '🟢 OpenAI' },
]

export const APP_DEFAULT_FIELDS = {
  // ── General ──────────────────────────────────────────────────────────────────
  'resume builder': [
    { id: 'full_name',   label: 'Full Name',       placeholder: 'e.g. Sarah Johnson',                        required: true  },
    { id: 'job_title',   label: 'Target Job Title', placeholder: 'e.g. Senior Product Manager',              required: true  },
    { id: 'experience',  label: 'Work Experience',  placeholder: 'e.g. 5 yrs at Acme as PM, 3 yrs at XYZ',  required: true  },
    { id: 'skills',      label: 'Key Skills',        placeholder: 'e.g. Agile, Roadmapping, SQL, Stakeholder management', required: true },
    { id: 'education',   label: 'Education',         placeholder: 'e.g. BSc Computer Science, University of Manchester 2018', required: false },
  ],
  'cover letter writer': [
    { id: 'company',     label: 'Company Name',          placeholder: 'e.g. Google',                         required: true  },
    { id: 'job_title',   label: 'Job Title',             placeholder: 'e.g. Senior Software Engineer',       required: true  },
    { id: 'manager',     label: 'Hiring Manager Name',   placeholder: 'e.g. Alex Carter (or "not known")',   required: false },
    { id: 'why',         label: 'Why You\'re Interested', placeholder: 'e.g. Passionate about AI at scale; admire their engineering culture', required: true },
  ],
  'interview coach': [
    { id: 'candidate',      label: 'Candidate Name',       placeholder: 'e.g. James Wilson',                 required: true  },
    { id: 'role',           label: 'Target Role',          placeholder: 'e.g. Data Scientist at OpenAI',     required: true  },
    { id: 'experience',     label: 'Years of Experience',  placeholder: 'e.g. 4 years in Python & ML',       required: true  },
    { id: 'interview_type', label: 'Interview Type',       placeholder: 'e.g. Behavioural / Technical / Case Study', required: true },
  ],
  'interview prep': [
    { id: 'role',           label: 'Role Being Interviewed For', placeholder: 'e.g. Senior Engineer at Stripe', required: true },
    { id: 'interview_type', label: 'Interview Type',             placeholder: 'e.g. System Design / Behavioural', required: true },
    { id: 'weak_areas',     label: 'Areas to Focus On',         placeholder: 'e.g. Leadership questions, conflict resolution', required: false },
  ],
  'research assistant': [
    { id: 'topic',     label: 'Topic / Subject',   placeholder: 'e.g. Generative AI in healthcare',          required: true  },
    { id: 'focus',     label: 'Research Focus',    placeholder: 'e.g. Recent studies, market size, key players', required: true },
    { id: 'audience',  label: 'Target Audience',   placeholder: 'e.g. Non-technical executives',             required: false },
    { id: 'depth',     label: 'Depth',             placeholder: 'Overview / Detailed / Deep-dive',           required: false },
  ],
  'content writer': [
    { id: 'topic',     label: 'Topic',             placeholder: 'e.g. How to scale a startup team',          required: true  },
    { id: 'audience',  label: 'Target Audience',   placeholder: 'e.g. First-time founders',                  required: true  },
    { id: 'type',      label: 'Content Type',      placeholder: 'e.g. Blog post / Newsletter / LinkedIn article', required: true },
    { id: 'tone',      label: 'Tone',              placeholder: 'e.g. Conversational, practical, no jargon', required: false },
    { id: 'length',    label: 'Word Count',        placeholder: 'e.g. 800 words',                            required: false },
  ],
  'social media post generator': [
    { id: 'topic',     label: 'Topic or Content',  placeholder: 'e.g. Our new AI feature launch',            required: true  },
    { id: 'platform',  label: 'Platform',          placeholder: 'LinkedIn / Twitter / Instagram / Facebook', required: true  },
    { id: 'tone',      label: 'Tone',              placeholder: 'e.g. Enthusiastic, professional, witty',    required: false },
    { id: 'cta',       label: 'Key Message / CTA', placeholder: 'e.g. Drive signups to aistrix.app',         required: false },
  ],
  'market research assistant': [
    { id: 'industry',  label: 'Industry / Market',       placeholder: 'e.g. EdTech SaaS',                   required: true  },
    { id: 'segment',   label: 'Target Customer Segment', placeholder: 'e.g. SMB HR teams',                   required: true  },
    { id: 'geography', label: 'Geography',               placeholder: 'e.g. UK & Europe',                    required: false },
    { id: 'goal',      label: 'Business Goal',           placeholder: 'e.g. Assessing market entry feasibility', required: false },
  ],
  'competitor analysis': [
    { id: 'competitor',  label: 'Competitor Name',    placeholder: 'e.g. Notion AI',                         required: true  },
    { id: 'your_co',     label: 'Your Company/Product', placeholder: 'e.g. Aistrix',                         required: true  },
    { id: 'industry',    label: 'Industry',            placeholder: 'e.g. AI productivity tools',            required: false },
    { id: 'focus',       label: 'Analysis Focus',      placeholder: 'e.g. Pricing, features, positioning',   required: false },
  ],
  'executive summary generator': [
    { id: 'content',   label: 'Content to Summarise', placeholder: 'Paste the document, report, or data here', required: true },
    { id: 'audience',  label: 'Target Audience',      placeholder: 'e.g. Board of directors',                required: true  },
    { id: 'length',    label: 'Summary Length',       placeholder: 'e.g. One page / 3 bullet points',        required: false },
  ],
  'business plan builder': [
    { id: 'idea',      label: 'Business Idea / Name', placeholder: 'e.g. AI-powered invoice processing SaaS', required: true },
    { id: 'market',    label: 'Target Market',        placeholder: 'e.g. UK accountancy firms with 5–50 staff', required: true },
    { id: 'revenue',   label: 'Revenue Model',        placeholder: 'e.g. Monthly subscription £49/user',      required: true },
    { id: 'usp',       label: 'Main Differentiator',  placeholder: 'e.g. First to integrate with Xero & Sage natively', required: false },
  ],
  'business proposal writer': [
    { id: 'client',    label: 'Client Name',          placeholder: 'e.g. TechCorp Ltd',                      required: true  },
    { id: 'project',   label: 'Project Description',  placeholder: 'e.g. Rebuild internal HR portal',        required: true  },
    { id: 'budget',    label: 'Budget Range',         placeholder: 'e.g. £25,000–£40,000',                   required: false },
    { id: 'timeline',  label: 'Timeline',             placeholder: 'e.g. 12 weeks starting March',           required: false },
  ],
  // ── Sales ─────────────────────────────────────────────────────────────────────
  'lead qualifier': [
    { id: 'lead_name', label: 'Lead Name / Company', placeholder: 'e.g. John Smith, Acme Corp',              required: true  },
    { id: 'industry',  label: 'Industry',            placeholder: 'e.g. Manufacturing / SaaS / Retail',      required: true  },
    { id: 'budget',    label: 'Budget Range',        placeholder: 'e.g. £10k–£50k per year',                 required: false },
    { id: 'pain',      label: 'Pain Points / Challenges', placeholder: 'e.g. Manual data entry, slow approvals', required: true },
  ],
  'cold email writer': [
    { id: 'prospect',  label: 'Prospect Name',       placeholder: 'e.g. Sarah Lee',                          required: true  },
    { id: 'company',   label: 'Their Company',       placeholder: 'e.g. Bloom Retail Ltd',                   required: true  },
    { id: 'industry',  label: 'Their Industry',      placeholder: 'e.g. E-commerce',                         required: false },
    { id: 'product',   label: 'Your Product / Service', placeholder: 'e.g. AI invoicing automation',         required: true  },
    { id: 'value',     label: 'Key Value Proposition', placeholder: 'e.g. Cuts invoice processing time by 80%', required: true },
  ],
  'outreach email writer': [
    { id: 'prospect',  label: 'Prospect Name',       placeholder: 'e.g. David Chen',                         required: true  },
    { id: 'company',   label: 'Their Company',       placeholder: 'e.g. NovaTech Solutions',                 required: true  },
    { id: 'pain',      label: 'Their Pain Point',    placeholder: 'e.g. Slow onboarding, high churn',        required: true  },
    { id: 'solution',  label: 'Your Solution',       placeholder: 'e.g. Automated onboarding workflows',     required: true  },
  ],
  'follow-up email generator': [
    { id: 'context',   label: 'Original Outreach Context', placeholder: 'e.g. Sent cold email re: AI invoicing tool', required: true },
    { id: 'days',      label: 'Days Since Last Contact',   placeholder: 'e.g. 5',                            required: true  },
    { id: 'next_step', label: 'Desired Next Step',         placeholder: 'e.g. Book a 20-min demo call',      required: true  },
  ],
  'prospect researcher': [
    { id: 'name',      label: 'Company / Person Name', placeholder: 'e.g. Bloom Retail Ltd / Sarah Lee',    required: true  },
    { id: 'industry',  label: 'Industry',              placeholder: 'e.g. UK e-commerce',                   required: true  },
    { id: 'deal_size', label: 'Estimated Deal Size',   placeholder: 'e.g. £20k ARR',                        required: false },
    { id: 'goal',      label: 'Research Goal',         placeholder: 'e.g. Find pain points before outreach', required: false },
  ],
  'sales objection analyzer': [
    { id: 'objection', label: 'The Objection Raised', placeholder: 'e.g. "We already use HubSpot for this"', required: true },
    { id: 'product',   label: 'Your Product / Service', placeholder: 'e.g. Aistrix AI Workflows',           required: true  },
    { id: 'context',   label: 'Customer Context',     placeholder: 'e.g. Mid-size SaaS, 50 person sales team', required: false },
  ],
  'rebuttal writer': [
    { id: 'objection', label: 'Objection to Address', placeholder: 'e.g. "It\'s too expensive"',            required: true  },
    { id: 'strengths', label: 'Your Product\'s Strengths', placeholder: 'e.g. Fastest ROI, no-code setup',  required: true  },
    { id: 'concern',   label: 'Customer\'s Main Concern', placeholder: 'e.g. Budget approval from CFO',     required: false },
  ],
  'crm summary generator': [
    { id: 'customer',  label: 'Customer Name',        placeholder: 'e.g. Acme Corp / John Smith',            required: true  },
    { id: 'type',      label: 'Interaction Type',     placeholder: 'e.g. Discovery call / Product demo / QBR', required: true },
    { id: 'outcomes',  label: 'Key Outcomes',         placeholder: 'e.g. Agreed to trial, budget confirmed £30k', required: true },
    { id: 'next',      label: 'Next Steps',           placeholder: 'e.g. Send proposal by Friday',           required: false },
  ],
  'call transcript analyzer': [
    { id: 'transcript', label: 'Call Transcript',    placeholder: 'Paste the call transcript here',          required: true  },
    { id: 'customer',   label: 'Customer Name',      placeholder: 'e.g. Sarah @ Bloom Retail',               required: false },
    { id: 'product',    label: 'Product Discussed',  placeholder: 'e.g. Aistrix Pro Plan',                   required: false },
  ],
  'deal signal extractor': [
    { id: 'content',   label: 'Call / Email Transcript', placeholder: 'Paste conversation content here',     required: true  },
    { id: 'stage',     label: 'Deal Stage',              placeholder: 'e.g. Proposal sent / Negotiation',    required: true  },
    { id: 'customer',  label: 'Customer Name',           placeholder: 'e.g. NovaTech Ltd',                   required: false },
  ],
  'next step advisor': [
    { id: 'stage',     label: 'Deal Stage',          placeholder: 'e.g. Discovery / Demo / Negotiation',     required: true  },
    { id: 'signals',   label: 'Customer Signals',    placeholder: 'e.g. Asked about pricing, CC\'d their CFO', required: true },
    { id: 'last',      label: 'Last Interaction Summary', placeholder: 'e.g. 30-min demo, positive response', required: false },
  ],
  // ── HR ────────────────────────────────────────────────────────────────────────
  'resume screener': [
    { id: 'resume',    label: 'Resume / CV Text',    placeholder: 'Paste the candidate\'s CV here',          required: true  },
    { id: 'job_title', label: 'Job Title',           placeholder: 'e.g. Senior Backend Engineer',            required: true  },
    { id: 'required',  label: 'Required Skills',     placeholder: 'e.g. Python, AWS, 5+ years experience',   required: true  },
    { id: 'nice',      label: 'Nice-to-Have Skills', placeholder: 'e.g. Kubernetes, team lead experience',   required: false },
  ],
  'interview question generator': [
    { id: 'role',      label: 'Role',                placeholder: 'e.g. Head of Marketing',                  required: true  },
    { id: 'level',     label: 'Experience Level',    placeholder: 'e.g. Senior / Mid / Junior',              required: true  },
    { id: 'skills',    label: 'Key Skills to Test',  placeholder: 'e.g. Data analysis, team leadership, budget management', required: true },
    { id: 'type',      label: 'Interview Type',      placeholder: 'e.g. Behavioural / Technical / Competency', required: true },
  ],
  'offer letter writer': [
    { id: 'candidate', label: 'Candidate Name',      placeholder: 'e.g. Emma Clarke',                        required: true  },
    { id: 'role',      label: 'Role / Job Title',    placeholder: 'e.g. Product Designer',                   required: true  },
    { id: 'start',     label: 'Start Date',          placeholder: 'e.g. 3rd March 2025',                     required: true  },
    { id: 'salary',    label: 'Salary / Package',    placeholder: 'e.g. £55,000 + 10% bonus + 25 days holiday', required: true },
    { id: 'benefits',  label: 'Key Benefits',        placeholder: 'e.g. Private health, remote-first, £1k L&D budget', required: false },
  ],
  'rejection email writer': [
    { id: 'candidate', label: 'Candidate Name',      placeholder: 'e.g. Michael Chen',                       required: true  },
    { id: 'role',      label: 'Role Applied For',    placeholder: 'e.g. Marketing Manager',                  required: true  },
    { id: 'stage',     label: 'Stage Reached',       placeholder: 'e.g. First interview / CV screen / Final round', required: true },
    { id: 'tone',      label: 'Tone',               placeholder: 'Warm and encouraging / Formal and brief',  required: false },
  ],
  'candidate feedback generator': [
    { id: 'candidate', label: 'Candidate Name',      placeholder: 'e.g. Priya Sharma',                       required: true  },
    { id: 'role',      label: 'Role',                placeholder: 'e.g. Data Analyst',                       required: true  },
    { id: 'strengths', label: 'Key Strengths Observed', placeholder: 'e.g. Strong SQL, great communication', required: true },
    { id: 'develop',   label: 'Areas to Develop',   placeholder: 'e.g. Stakeholder management, Python depth', required: true },
  ],
  'welcome email generator': [
    { id: 'name',      label: 'New Hire Name',       placeholder: 'e.g. Tom Baker',                          required: true  },
    { id: 'role',      label: 'Role',                placeholder: 'e.g. Customer Success Manager',           required: true  },
    { id: 'start',     label: 'Start Date',          placeholder: 'e.g. Monday 10th February',               required: true  },
    { id: 'manager',   label: 'Manager Name',        placeholder: 'e.g. Lisa Nguyen',                        required: false },
    { id: 'first_day', label: 'First Day Details',   placeholder: 'e.g. 9am Zoom onboarding, then team lunch', required: false },
  ],
  'onboarding plan builder': [
    { id: 'name',      label: 'New Hire Name',       placeholder: 'e.g. Chris Lee',                          required: true  },
    { id: 'role',      label: 'Role / Title',        placeholder: 'e.g. Sales Development Representative',  required: true  },
    { id: 'dept',      label: 'Department',          placeholder: 'e.g. Sales',                              required: false },
    { id: 'tools',     label: 'Key Tools / Systems', placeholder: 'e.g. HubSpot, Slack, Notion, Salesforce', required: false },
  ],
  'job description writer': [
    { id: 'title',     label: 'Job Title',           placeholder: 'e.g. Head of Growth',                     required: true  },
    { id: 'dept',      label: 'Department',          placeholder: 'e.g. Marketing',                          required: false },
    { id: 'responsibilities', label: 'Key Responsibilities', placeholder: 'e.g. Own SEO, manage 2 content writers, report to CMO', required: true },
    { id: 'requirements',    label: 'Required Qualifications', placeholder: 'e.g. 5+ years in B2B SaaS marketing, data-driven mindset', required: true },
  ],
  'achievement summarizer': [
    { id: 'name',      label: 'Employee Name',       placeholder: 'e.g. Danielle Roberts',                   required: true  },
    { id: 'period',    label: 'Review Period',       placeholder: 'e.g. Jan–Dec 2024',                       required: true  },
    { id: 'achievements', label: 'Key Achievements', placeholder: 'e.g. Grew pipeline 40%, launched 2 new products, mentored 3 juniors', required: true },
  ],
  'review writer': [
    { id: 'name',      label: 'Employee Name',       placeholder: 'e.g. Jordan Kim',                         required: true  },
    { id: 'role',      label: 'Role',                placeholder: 'e.g. Software Engineer L3',               required: true  },
    { id: 'period',    label: 'Performance Period',  placeholder: 'e.g. H2 2024',                            required: true  },
    { id: 'highlights', label: 'Key Achievements',  placeholder: 'e.g. Led migration to microservices, improved uptime to 99.9%', required: true },
    { id: 'develop',   label: 'Areas to Develop',   placeholder: 'e.g. Documentation, cross-team communication', required: false },
  ],
  'goal recommendation generator': [
    { id: 'role',      label: 'Role',                placeholder: 'e.g. Account Executive',                  required: true  },
    { id: 'perf',      label: 'Current Performance Level', placeholder: 'e.g. Meeting targets, strong closer but weak at prospecting', required: true },
    { id: 'aspiration', label: 'Career Aspiration', placeholder: 'e.g. Move into Sales Leadership within 2 years', required: false },
  ],
  // ── Support ───────────────────────────────────────────────────────────────────
  'ticket classifier': [
    { id: 'subject',   label: 'Ticket Subject',      placeholder: 'e.g. Can\'t log in — password reset not working', required: true },
    { id: 'message',   label: 'Customer Message',    placeholder: 'Paste the customer\'s message here',     required: true  },
    { id: 'product',   label: 'Product / Feature',   placeholder: 'e.g. Auth / Billing / Mobile App',       required: false },
    { id: 'tier',      label: 'Customer Tier',       placeholder: 'e.g. Free / Pro / Enterprise',           required: false },
  ],
  'support response writer': [
    { id: 'customer',  label: 'Customer Name',       placeholder: 'e.g. Mike',                               required: false },
    { id: 'issue',     label: 'Issue Described',     placeholder: 'e.g. Dashboard not loading after last update', required: true },
    { id: 'product',   label: 'Product / Version',  placeholder: 'e.g. Aistrix Web v2.1',                   required: false },
    { id: 'outcome',   label: 'Desired Outcome',    placeholder: 'e.g. Resolve issue or offer workaround',  required: false },
  ],
  'customer message analyzer': [
    { id: 'message',   label: 'Customer Message / Email', placeholder: 'Paste the full customer message here', required: true },
    { id: 'product',   label: 'Product Context',    placeholder: 'e.g. Aistrix Workflow Builder',            required: false },
    { id: 'account',   label: 'Customer Account Type', placeholder: 'e.g. Pro plan, 6 months old',           required: false },
  ],
  'escalation risk analyzer': [
    { id: 'ticket',    label: 'Ticket / Conversation', placeholder: 'Paste the full support thread here',    required: true  },
    { id: 'history',   label: 'Customer History',    placeholder: 'e.g. 3rd ticket this month, Pro customer since 2022', required: false },
    { id: 'severity',  label: 'Issue Severity',      placeholder: 'e.g. Can\'t use core feature / Minor UI bug', required: false },
  ],
  'support thread summarizer': [
    { id: 'thread',    label: 'Thread / Conversation', placeholder: 'Paste the full conversation here',      required: true  },
    { id: 'issue',     label: 'Issue Type',           placeholder: 'e.g. Billing dispute / Feature bug / Data loss', required: false },
    { id: 'customer',  label: 'Customer Name',        placeholder: 'e.g. Acme Corp',                         required: false },
  ],
  'escalation summary generator': [
    { id: 'issue',     label: 'Issue Description',   placeholder: 'e.g. Customer lost 3 weeks of data after migration', required: true },
    { id: 'steps',     label: 'Steps Already Taken', placeholder: 'e.g. Attempted restore from backup, contacted engineering', required: true },
    { id: 'impact',    label: 'Business Impact',     placeholder: 'e.g. Customer at risk of churn, £50k ARR', required: true },
  ],
  'tone adjuster': [
    { id: 'original',  label: 'Original Response',   placeholder: 'Paste the draft response to rewrite',    required: true  },
    { id: 'tone',      label: 'Desired Tone',        placeholder: 'e.g. Empathetic & apologetic / Confident & direct', required: true },
    { id: 'context',   label: 'Customer Context',    placeholder: 'e.g. Angry long-term customer / New user confused', required: false },
  ],
  'faq generator': [
    { id: 'topic',     label: 'Topic / Product',     placeholder: 'e.g. Aistrix billing and subscriptions',  required: true  },
    { id: 'theme',     label: 'Common Question Theme', placeholder: 'e.g. Upgrade process, refund policy',   required: true  },
    { id: 'audience',  label: 'Target Audience',     placeholder: 'e.g. Non-technical small business owners', required: false },
  ],
  'help article writer': [
    { id: 'topic',     label: 'Topic',               placeholder: 'e.g. How to set up your first AI workflow', required: true },
    { id: 'user',      label: 'Target User',         placeholder: 'e.g. Non-technical business owner',       required: false },
    { id: 'problem',   label: 'Problem Being Solved', placeholder: 'e.g. Users don\'t know where to start',  required: true  },
    { id: 'steps',     label: 'Key Steps Involved',  placeholder: 'e.g. 1. Open workflows 2. Click build 3. Add apps', required: false },
  ],
  'priority classifier': [
    { id: 'issue',     label: 'Issue Type',          placeholder: 'e.g. Data loss / Login failure / UI glitch', required: true },
    { id: 'tier',      label: 'Customer Tier',       placeholder: 'e.g. Enterprise / Pro / Free',             required: true  },
    { id: 'impact',    label: 'Business Impact',     placeholder: 'e.g. Blocking 50 users from working',      required: false },
    { id: 'urgency',   label: 'Urgency',            placeholder: 'e.g. Reported 10 mins ago / Been ongoing 3 days', required: false },
  ],
  'customer feedback analyzer': [
    { id: 'feedback',  label: 'Feedback / Reviews',  placeholder: 'Paste customer feedback, reviews, or survey responses here', required: true },
    { id: 'product',   label: 'Product / Feature',   placeholder: 'e.g. Mobile app, checkout flow',           required: false },
    { id: 'period',    label: 'Time Period',          placeholder: 'e.g. Q4 2024',                             required: false },
  ],
  // ── Finance ───────────────────────────────────────────────────────────────────
  'invoice reviewer': [
    { id: 'invoice',   label: 'Invoice Details',     placeholder: 'Paste the invoice text or key line items here', required: true },
    { id: 'vendor',    label: 'Vendor Name',         placeholder: 'e.g. Acme Supplies Ltd',                   required: true  },
    { id: 'expected',  label: 'Expected Amounts',    placeholder: 'e.g. PO for £4,200 — check against this',  required: false },
  ],
  'expense categorizer': [
    { id: 'expenses',  label: 'Expense Items',       placeholder: 'List or paste the expense lines here',     required: true  },
    { id: 'dept',      label: 'Department',          placeholder: 'e.g. Sales / Engineering / Marketing',     required: true  },
    { id: 'period',    label: 'Period',              placeholder: 'e.g. January 2025',                        required: false },
  ],
  'financial summary generator': [
    { id: 'data',      label: 'Financial Data / Figures', placeholder: 'Paste the numbers, tables, or report excerpts here', required: true },
    { id: 'report_type', label: 'Report Type',      placeholder: 'e.g. Monthly P&L / Cash flow / Board pack', required: true },
    { id: 'audience',  label: 'Audience',           placeholder: 'e.g. Board / CFO / Investors',              required: true  },
    { id: 'period',    label: 'Period',             placeholder: 'e.g. FY2024 Q3',                            required: false },
  ],
  'variance analyzer': [
    { id: 'figures',   label: 'Budget vs Actual Figures', placeholder: 'e.g. Revenue: Budget £500k, Actual £420k; COGS: Budget £200k, Actual £195k', required: true },
    { id: 'period',    label: 'Period',             placeholder: 'e.g. Q3 2024',                              required: true  },
    { id: 'dept',      label: 'Department / Category', placeholder: 'e.g. Marketing / Total company',         required: false },
  ],
  'root cause identifier': [
    { id: 'variance',  label: 'Variance Description', placeholder: 'e.g. Revenue £80k below budget in October', required: true },
    { id: 'history',   label: 'Historical Context',  placeholder: 'e.g. Q2 and Q3 were on track; dip started in September', required: false },
    { id: 'events',    label: 'Business Events',     placeholder: 'e.g. Lost 2 enterprise clients; launched new pricing in Sept', required: false },
  ],
  'financial report writer': [
    { id: 'data',      label: 'Financial Data',      placeholder: 'Paste key figures, tables, or KPIs here', required: true  },
    { id: 'type',      label: 'Report Type',         placeholder: 'e.g. Monthly management accounts / Board presentation', required: true },
    { id: 'audience',  label: 'Audience',            placeholder: 'e.g. Non-finance board members',           required: true  },
    { id: 'messages',  label: 'Key Messages',        placeholder: 'e.g. Strong cash position, revenue below plan', required: false },
  ],
  'financial data analyzer': [
    { id: 'data',      label: 'Financial Data / Metrics', placeholder: 'Paste your financial data or KPIs here', required: true },
    { id: 'period',    label: 'Current Period',      placeholder: 'e.g. January 2025',                        required: true  },
    { id: 'compare',   label: 'Comparison Period',   placeholder: 'e.g. January 2024 / Last month',           required: false },
  ],
  'kpi report generator': [
    { id: 'kpis',      label: 'KPIs and Values',     placeholder: 'e.g. MRR: £120k (target £130k), Churn: 3.2%, NPS: 48', required: true },
    { id: 'period',    label: 'Period',              placeholder: 'e.g. Q1 2025',                             required: true  },
    { id: 'dept',      label: 'Department',          placeholder: 'e.g. Sales / Customer Success / Overall',  required: false },
  ],
  'budget analyzer': [
    { id: 'data',      label: 'Budget Data',         placeholder: 'Paste budget lines, categories, and amounts here', required: true },
    { id: 'dept',      label: 'Department',          placeholder: 'e.g. Marketing',                           required: false },
    { id: 'period',    label: 'Period',             placeholder: 'e.g. FY2025',                               required: false },
    { id: 'goals',     label: 'Strategic Goals',    placeholder: 'e.g. Expand into Europe, grow enterprise ARR 40%', required: false },
  ],
  'management commentary writer': [
    { id: 'results',   label: 'Financial Results',   placeholder: 'Paste the key figures and variances here', required: true  },
    { id: 'period',    label: 'Period',             placeholder: 'e.g. November 2024',                        required: true  },
    { id: 'audience',  label: 'Audience',           placeholder: 'e.g. Board / Audit committee / Finance team', required: true },
    { id: 'themes',    label: 'Key Themes to Cover', placeholder: 'e.g. Strong cost control, revenue miss, positive cash position', required: false },
  ],
  // ── Marketing ─────────────────────────────────────────────────────────────────
  'audience researcher': [
    { id: 'product',   label: 'Product / Service',   placeholder: 'e.g. Aistrix AI Workflow Platform',        required: true  },
    { id: 'market',    label: 'Target Market',       placeholder: 'e.g. UK SMB operations teams',             required: true  },
    { id: 'geography', label: 'Geography',           placeholder: 'e.g. UK & Ireland',                        required: false },
    { id: 'goal',      label: 'Campaign Goal',       placeholder: 'e.g. Drive trial signups',                 required: false },
  ],
  'campaign brief writer': [
    { id: 'product',   label: 'Product / Service',   placeholder: 'e.g. Aistrix Pro Plan launch',             required: true  },
    { id: 'audience',  label: 'Target Audience',     placeholder: 'e.g. Operations managers at 20–200 person companies', required: true },
    { id: 'goal',      label: 'Campaign Goal',       placeholder: 'e.g. 500 free trial signups in 30 days',  required: true  },
    { id: 'budget',    label: 'Budget',             placeholder: 'e.g. £5,000 total across LinkedIn + Google', required: false },
    { id: 'timeline',  label: 'Timeline',           placeholder: 'e.g. March 1–31, 2025',                    required: false },
  ],
  'ad copy generator': [
    { id: 'product',   label: 'Product / Service',   placeholder: 'e.g. Aistrix AI Workflows',                required: true  },
    { id: 'audience',  label: 'Target Audience',     placeholder: 'e.g. Busy operations managers',            required: true  },
    { id: 'platform',  label: 'Ad Platform',         placeholder: 'LinkedIn / Google / Facebook / Instagram', required: true  },
    { id: 'benefit',   label: 'Key Benefit',         placeholder: 'e.g. Save 10 hours a week on repetitive tasks', required: true },
    { id: 'tone',      label: 'Tone',               placeholder: 'e.g. Professional and direct / Conversational', required: false },
  ],
  'seo analyzer': [
    { id: 'topic',     label: 'Target Topic',        placeholder: 'e.g. AI workflow automation for SMBs',     required: true  },
    { id: 'keywords',  label: 'Target Keywords',     placeholder: 'e.g. AI workflow tool, business automation software', required: true },
    { id: 'competitors', label: 'Competitor URLs',   placeholder: 'e.g. zapier.com/blog/..., make.com/...',   required: false },
    { id: 'goal',      label: 'Content Goal',        placeholder: 'e.g. Rank in top 5 for "AI workflow tool"', required: false },
  ],
  'blog post writer': [
    { id: 'topic',     label: 'Topic',               placeholder: 'e.g. How AI workflows save small businesses 10 hours a week', required: true },
    { id: 'audience',  label: 'Target Audience',     placeholder: 'e.g. Non-technical small business owners', required: true  },
    { id: 'length',    label: 'Word Count',          placeholder: 'e.g. 1,200 words',                         required: false },
    { id: 'points',    label: 'Key Points to Cover', placeholder: 'e.g. Time cost of manual tasks, ROI of automation, getting started', required: false },
  ],
  'meta tag generator': [
    { id: 'topic',     label: 'Page Topic',          placeholder: 'e.g. AI Workflow Builder for Business Teams', required: true },
    { id: 'keyword',   label: 'Primary Keyword',     placeholder: 'e.g. AI workflow tool',                    required: true  },
    { id: 'audience',  label: 'Target Audience',     placeholder: 'e.g. SMB operations managers',             required: false },
    { id: 'type',      label: 'Page Type',           placeholder: 'e.g. Product page / Blog post / Landing page', required: false },
  ],
  'content summarizer': [
    { id: 'content',   label: 'Content to Repurpose', placeholder: 'Paste the full article, video script, or post here', required: true },
    { id: 'original',  label: 'Original Platform',   placeholder: 'e.g. Long-form blog post',                 required: false },
    { id: 'targets',   label: 'Target Platforms',    placeholder: 'e.g. Email newsletter, Twitter thread, LinkedIn post', required: true },
  ],
  'email newsletter writer': [
    { id: 'topic',     label: 'Topic / Theme',       placeholder: 'e.g. How we reached 1,000 users',          required: true  },
    { id: 'segment',   label: 'Audience Segment',    placeholder: 'e.g. Pro subscribers / Free tier users',   required: false },
    { id: 'message',   label: 'Key Message',         placeholder: 'e.g. We launched 3 new features this month', required: true },
    { id: 'cta',       label: 'Call to Action',      placeholder: 'e.g. Upgrade to Pro / Try the new feature', required: false },
  ],
  'brand voice analyzer': [
    { id: 'brand',     label: 'Brand Name',          placeholder: 'e.g. Aistrix',                             required: true  },
    { id: 'industry',  label: 'Industry',            placeholder: 'e.g. B2B SaaS / Professional services',    required: false },
    { id: 'values',    label: 'Brand Values',        placeholder: 'e.g. Empowering, simple, honest, smart',   required: true  },
    { id: 'sample',    label: 'Sample Existing Content', placeholder: 'Paste 2–3 paragraphs of your best existing copy', required: false },
  ],
  'copy rewriter': [
    { id: 'original',  label: 'Original Copy',       placeholder: 'Paste the copy you want rewritten here',  required: true  },
    { id: 'tone',      label: 'Target Tone / Voice', placeholder: 'e.g. Warm and conversational / Authoritative and direct', required: true },
    { id: 'platform',  label: 'Platform',            placeholder: 'e.g. Website homepage / LinkedIn / Email', required: false },
    { id: 'audience',  label: 'Audience',            placeholder: 'e.g. Senior finance leaders',              required: false },
  ],
  'style guide generator': [
    { id: 'brand',     label: 'Brand Name',          placeholder: 'e.g. Aistrix',                             required: true  },
    { id: 'tone',      label: 'Tone Pillars',        placeholder: 'e.g. Clear, empowering, conversational, credible', required: true },
    { id: 'dos',       label: 'Do\'s (with examples)', placeholder: 'e.g. Use short sentences. Say "you" not "the user"', required: false },
    { id: 'donts',     label: 'Don\'ts (with examples)', placeholder: 'e.g. Avoid jargon. Don\'t use passive voice', required: false },
  ],
  // ── Founders ──────────────────────────────────────────────────────────────────
  'business idea validator': [
    { id: 'idea',      label: 'Business Idea',       placeholder: 'e.g. AI tool that auto-generates grant applications for UK charities', required: true },
    { id: 'market',    label: 'Target Market',       placeholder: 'e.g. UK charities with 10–100 staff',     required: true  },
    { id: 'problem',   label: 'Problem Being Solved', placeholder: 'e.g. Grant writing takes 40+ hours per application', required: true },
    { id: 'alts',      label: 'Current Alternatives', placeholder: 'e.g. Manual writing, expensive grant consultants', required: false },
  ],
  'opportunity analyzer': [
    { id: 'market',    label: 'Market / Problem',    placeholder: 'e.g. UK SMBs spend 8 hours/week on manual admin', required: true },
    { id: 'angle',     label: 'Your Unique Angle',   placeholder: 'e.g. AI-first, no-code, sub-£100/month',  required: true  },
    { id: 'customer',  label: 'Target Customer',     placeholder: 'e.g. Operations managers at 10–50 person firms', required: true },
    { id: 'competition', label: 'Competition',       placeholder: 'e.g. Zapier (complex), Make (technical), ChatGPT (generic)', required: false },
  ],
  'pitch deck writer': [
    { id: 'company',   label: 'Company Name',        placeholder: 'e.g. Aistrix',                             required: true  },
    { id: 'problem',   label: 'Problem',             placeholder: 'e.g. SMBs waste 10+ hours/week on repetitive tasks that AI could automate', required: true },
    { id: 'solution',  label: 'Solution',            placeholder: 'e.g. No-code AI workflow builder that chains AI apps into automated pipelines', required: true },
    { id: 'market',    label: 'Market Size',         placeholder: 'e.g. £2.4B SMB automation market, growing 25% YoY', required: false },
    { id: 'model',     label: 'Business Model',      placeholder: 'e.g. SaaS £49/mo per seat, enterprise from £500/mo', required: true },
    { id: 'traction',  label: 'Traction',           placeholder: 'e.g. 200 users, £8k MRR, 40% MoM growth', required: false },
  ],
  'value proposition writer': [
    { id: 'product',   label: 'Product / Service',   placeholder: 'e.g. Aistrix AI Workflows',                required: true  },
    { id: 'customer',  label: 'Target Customer',     placeholder: 'e.g. Non-technical operations managers',   required: true  },
    { id: 'pain',      label: 'Main Pain Point',     placeholder: 'e.g. Hours wasted on repetitive document tasks', required: true },
    { id: 'differentiators', label: 'Key Differentiators', placeholder: 'e.g. No-code, context-aware AI, 5-minute setup', required: true },
  ],
  'investor faq builder': [
    { id: 'company',   label: 'Company Name',        placeholder: 'e.g. Aistrix',                             required: true  },
    { id: 'stage',     label: 'Stage',               placeholder: 'e.g. Pre-seed / Seed / Series A',          required: true  },
    { id: 'model',     label: 'Revenue Model',       placeholder: 'e.g. Monthly SaaS, £49/seat',              required: true  },
    { id: 'market',    label: 'Market Size',         placeholder: 'e.g. £2.4B TAM, £480M SAM',               required: false },
    { id: 'team',      label: 'Team Background',     placeholder: 'e.g. 2 founders, ex-Google PM + 10yr SaaS engineer', required: false },
  ],
  'gtm strategy builder': [
    { id: 'product',   label: 'Product / Service',   placeholder: 'e.g. Aistrix AI Workflows',                required: true  },
    { id: 'customer',  label: 'Target Customer',     placeholder: 'e.g. UK SMB operations managers',          required: true  },
    { id: 'geography', label: 'Geography',           placeholder: 'e.g. UK initially, then EU',               required: false },
    { id: 'timeline',  label: 'Launch Timeline',     placeholder: 'e.g. 90 days to first 100 customers',      required: false },
  ],
  'channel analyzer': [
    { id: 'product',   label: 'Product / Service',   placeholder: 'e.g. B2B SaaS productivity tool',          required: true  },
    { id: 'audience',  label: 'Target Audience',     placeholder: 'e.g. HR managers at 50–200 person companies', required: true },
    { id: 'budget',    label: 'Budget',              placeholder: 'e.g. £2,000/month marketing budget',       required: false },
    { id: 'current',   label: 'Current Channels',    placeholder: 'e.g. LinkedIn organic, Google Ads',        required: false },
  ],
  'launch announcement writer': [
    { id: 'product',   label: 'Product / Feature Name', placeholder: 'e.g. Aistrix Webhook Triggers',         required: true  },
    { id: 'benefits',  label: 'Key Benefits',           placeholder: 'e.g. Trigger workflows from any external tool automatically', required: true },
    { id: 'audience',  label: 'Target Audience',        placeholder: 'e.g. Existing Pro users + developer community', required: true },
    { id: 'date',      label: 'Launch Date',            placeholder: 'e.g. March 1st, 2025',                  required: false },
  ],
}
