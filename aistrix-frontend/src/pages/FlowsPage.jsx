import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { timeAgo } from '../utils'
import { useToast } from '../hooks/useToast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExportActions } from '../components/OutputRenderer'
import { parseSSELine } from '../lib/sse'
import { duplicateApp } from '../utils/appActions'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const EMOJIS = ['⚡','🔗','🔄','📋','🧩','🚀','💡','🎯','📈','🛠️','💼','🎓','🔬','✍️','📊']

function shortModelName(model) {
  if (!model) return 'AI'
  if (model.includes('haiku')) return 'Haiku'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('opus')) return 'Opus'
  if (model.includes('gpt-4o-mini')) return 'GPT-4o Mini'
  if (model.includes('gpt-4o')) return 'GPT-4o'
  return model
}

// Quick-start templates organized by business pack.
// pack property groups them in the UI; install logic stays the same (fuzzy name match).
const QUICK_START_TEMPLATES = [
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

const TEMPLATE_PACKS = ['General', 'Sales', 'HR', 'Support', 'Finance', 'Marketing', 'Founders']

// Default input fields shown to runners for each known app type.
// Keys are lowercased app names for fuzzy matching.
const APP_DEFAULT_FIELDS = {
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

// ─── Workspace Progress (today only) — returns inline badge or null ────────────
function useTodayProgress(flow, userId) {
  const [ran, setRan] = useState(null)
  const steps = flow.steps || []
  useEffect(() => {
    if (!steps.length || !userId) return
    const ids = steps.map(s => s.app_id).filter(Boolean)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    supabase.from('run_history').select('app_id').eq('user_id', userId).in('app_id', ids)
      .gte('created_at', todayStart.toISOString())
      .then(({ data }) => setRan(new Set((data || []).map(r => r.app_id))))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when flow.id or userId changes
  }, [flow.id, userId])
  const done = ran ? [...ran].filter(id => steps.some(s => s.app_id === id)).length : 0
  return { done, total: steps.length }
}

function mergeMemory(prev, fresh) {
  const next = { ...prev }
  for (const [k, v] of Object.entries(fresh || {})) {
    if (Array.isArray(v)) {
      const existing = Array.isArray(next[k]) ? next[k] : (next[k] ? [next[k]] : [])
      next[k] = [...new Set([...existing, ...v.map(String)])]
    } else if (v !== null && v !== '') {
      next[k] = v
    }
  }
  return next
}

async function streamRun(body, session, onToken) {
  const res = await fetch(`${API_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  const reader = res.body.getReader(); const decoder = new TextDecoder()
  let buf = '', full = '', provider = null, model = null, usage = null
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const line of lines) {
      const d = parseSSELine(line)
      if (!d) continue
      if (d.token) { full += d.token; onToken?.(full) }
      if (d.done) { provider = d.provider || null; model = d.model || null; usage = d.usage || null }
    }
  }
  return { result: full, provider, model, usage }
}

async function sendToIntegration(url, flow, results, steps) {
  const text = `*${flow.emoji} ${flow.name}* — workflow complete\n\n` +
    steps.map((s, i) => `*${i + 1}. ${s.app_name}*\n${(results[i] || '').slice(0, 1500)}`).join('\n\n')
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ text, workspace: flow.name, steps: steps.map((s, i) => ({ app_name: s.app_name, result: results[i] || '' })) }),
  })
}

async function extractFacts(text, session) {
  try {
    const { result: full } = await streamRun({
      input: text.slice(0, 8000),
      system_prompt: 'Extract durable facts about the person/subject discussed: skills, accessibility needs or disabilities, identity, constraints, preferences, goals. Return ONLY a flat JSON object of short key:value pairs (use arrays for multi-value keys, e.g. "skills":["C++","Python"]). No prose, no markdown fences. If nothing durable is found, return {}.',
      ai_provider: 'claude',
    }, session)
    const match = full.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : {}
  } catch { return {} }
}

// ─── Native step form renderer (mirrors AppRunner's field rendering) ──────────
function NativeStepForm({ schema, values, onChange }) {
  const cls = 'w-full bg-[#09101F] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'
  return (
    <div className="space-y-3">
      {schema.map(f => (
        <div key={f.id}>
          <label className="text-xs text-slate-400 block mb-1.5">
            {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
          </label>
          {f.type === 'textarea' ? (
            <textarea className={cls} rows={3} placeholder={f.placeholder}
              value={values[f.id] || ''}
              onChange={e => onChange({ ...values, [f.id]: e.target.value })} />
          ) : f.type === 'select' ? (
            <select className={cls} value={values[f.id] || ''}
              onChange={e => onChange({ ...values, [f.id]: e.target.value })}>
              <option value="">Select…</option>
              {(f.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
              className={cls} placeholder={f.placeholder}
              value={values[f.id] || ''}
              onChange={e => onChange({ ...values, [f.id]: e.target.value })} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Flow Runner ─────────────────────────────────────────────────────────────
function FlowRunner({ flow, user, onClose, onShowHistory, onRunComplete }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [inputs, setInputs] = useState({})          // textarea input per step index
  const [formValues, setFormValues] = useState({})   // native form values per step index
  const [stepAppData, setStepAppData] = useState({}) // cached app metadata per step index
  const [results, setResults] = useState({})
  const [memory, setMemory] = useState(flow.memory || {})
  const [provenance, setProvenance] = useState(flow.memory_provenance || {})
  const [editingFact, setEditingFact] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [sendStatus, setSendStatus] = useState('idle')
  const [stepModels, setStepModels] = useState({})
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [tokenSource, setTokenSource] = useState(null)
  const [credits, setCredits] = useState(null)
  // Shared Workflow Context — accumulates source data (user inputs) and derived data (AI outputs)
  // Apps consume typed fields from this context, never raw previous-step text directly
  const [wfContext, setWfContext] = useState({ source: {}, derived: {} })
  const toast = useToast()

  const steps = flow.steps || []
  const current = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1
  const allDone = stepIndex >= steps.length

  // Fetch credits at mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetch(`${API_URL}/credits`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json()).then(setCredits).catch(() => {})
    })
  }, [])

  // Pre-fetch this step's app metadata so we know if it's native before the user runs it
  useEffect(() => {
    if (!current?.app_id || stepAppData[stepIndex]) return
    supabase.from('apps')
      .select('system_prompt, ai_provider, ai_model, app_type, form_schema')
      .eq('id', current.app_id).single()
      .then(({ data }) => { if (data) setStepAppData(p => ({ ...p, [stepIndex]: data })) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stepAppData is read as a cache check, not a trigger; only re-run on step/app change
  }, [stepIndex, current?.app_id])

  const isApiCallStep = current?.step_type === 'api_call'
  const isApprovalStep = current?.step_type === 'human_approval'
  const currentApp = stepAppData[stepIndex]
  const isNativeStep = !isApiCallStep && !isApprovalStep && currentApp?.app_type === 'native'
    && Array.isArray(currentApp?.form_schema) && currentApp.form_schema.length > 0

  // Approval step state
  const [approvalEdits, setApprovalEdits] = useState({})   // edited content per step index
  const [assignEmail, setAssignEmail] = useState('')
  const [assignNote, setAssignNote] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)

  function approvalPreviousOutput() {
    return results[stepIndex - 1] || inputs[stepIndex] || ''
  }
  function approveStep() {
    const content = current?.approval_type === 'edit'
      ? (approvalEdits[stepIndex] ?? approvalPreviousOutput())
      : approvalPreviousOutput()
    setResults(p => ({ ...p, [stepIndex]: content }))
    if (!isLast) setInputs(p => ({ ...p, [stepIndex + 1]: content }))
    setShowRejectForm(false)
  }
  function rejectWorkflow() {
    const reason = rejectionReason.trim() || 'Rejected at approval step.'
    toast(`Workflow stopped: ${reason}`, 'error')
    onClose()
  }

  // Use explicitly saved fields, or fall back to the built-in defaults for this app name
  const effectiveStepFields = current?.step_fields?.length
    ? current.step_fields
    : (!isApiCallStep && !isApprovalStep && current?.app_name
        ? APP_DEFAULT_FIELDS[current.app_name.toLowerCase()] || null
        : null)
  const hasStepFields = !!(effectiveStepFields?.length)

  function buildStepInput() {
    if (hasStepFields) {
      const vals = formValues[stepIndex] || {}
      return (effectiveStepFields || [])
        .map(f => vals[f.id]?.trim() ? `${f.label}: ${vals[f.id]}` : null)
        .filter(Boolean).join('\n')
    }
    if (isNativeStep) {
      const vals = formValues[stepIndex] || {}
      return (currentApp.form_schema || [])
        .map(f => vals[f.id]?.trim() ? `${f.label}: ${vals[f.id]}` : null)
        .filter(Boolean).join('\n')
    }
    return inputs[stepIndex] || ''
  }

  function isStepReady() {
    if (isApiCallStep) return true
    if (!currentApp) return false
    if (hasStepFields) {
      return (effectiveStepFields || []).filter(f => f.required)
        .every(f => (formValues[stepIndex] || {})[f.id]?.trim())
    }
    if (isNativeStep) {
      return (currentApp.form_schema || []).filter(f => f.required)
        .every(f => (formValues[stepIndex] || {})[f.id]?.trim())
    }
    return !!(inputs[stepIndex]?.trim())
  }

  // Readiness scoring: 'ready' | 'incomplete' | 'invalid'
  // ready    = all required fields filled with meaningful content (>3 chars each)
  // incomplete = required fields filled but optional fields empty or values very short
  // invalid  = required fields missing or clearly irrelevant (single word where sentence expected)
  function getReadinessScore() {
    if (isApiCallStep || isApprovalStep) return 'ready'
    const fields = hasStepFields ? effectiveStepFields : isNativeStep ? currentApp?.form_schema : []
    if (!fields?.length) {
      const raw = inputs[stepIndex] || ''
      if (!raw.trim()) return 'incomplete'
      if (raw.trim().split(/\s+/).length < 3) return 'invalid'
      return 'ready'
    }
    const vals = formValues[stepIndex] || {}
    const required = fields.filter(f => f.required)
    const missingRequired = required.filter(f => !vals[f.id]?.trim())
    if (missingRequired.length) return 'incomplete'
    const tooShort = required.filter(f => (vals[f.id]?.trim().length || 0) < 3)
    if (tooShort.length) return 'invalid'
    return 'ready'
  }

  useEffect(() => {
    if (!allDone || !flow.integration_webhook_url || sendStatus !== 'idle') return
    setSendStatus('sending')
    sendToIntegration(flow.integration_webhook_url, flow, results, steps)
      .then(() => setSendStatus('sent'))
      .catch(() => setSendStatus('error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire when allDone flips true; sendStatus guard prevents re-sends
  }, [allDone])

  // Fire onRunComplete(true) once all steps are done — must be before any early returns
  const completedRef = useRef(false)
  useEffect(() => {
    if (allDone && !completedRef.current) {
      completedRef.current = true
      onRunComplete?.(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- completedRef guard prevents re-firing; only need to check when allDone flips
  }, [allDone])

  function buildWorkflowContext() {
    // Source Data — typed fields the user entered across all completed steps
    const sourceLines = []
    for (let i = 0; i < stepIndex; i++) {
      const s = steps[i]
      const fields = s.step_fields?.length ? s.step_fields : APP_DEFAULT_FIELDS[s.app_name?.toLowerCase()] || []
      const vals = wfContext.source[i] || {}
      const filled = fields.filter(f => vals[f.id]?.trim())
      if (filled.length) {
        sourceLines.push(`${s.app_name} (Step ${i + 1}):`)
        filled.forEach(f => sourceLines.push(`  • ${f.label}: ${vals[f.id]}`))
      }
    }

    // Derived Data — AI-generated outputs from prior steps
    const derivedLines = []
    for (let i = 0; i < stepIndex; i++) {
      if (results[i] !== undefined) {
        const s = steps[i]
        derivedLines.push(`### Step ${i + 1} — ${s.app_name}:\n${results[i]}`)
      }
    }

    if (!sourceLines.length && !derivedLines.length) return null

    const parts = []
    if (sourceLines.length) {
      parts.push(`SOURCE DATA (verified user input — treat as ground truth):\n${sourceLines.join('\n')}`)
    }
    if (derivedLines.length) {
      parts.push(`DERIVED DATA (AI-generated from prior steps — use as context, not as final facts):\n${derivedLines.join('\n\n')}`)
    }
    return parts.join('\n\n═══\n\n')
  }

  // Keep buildHistoryContext as alias so nothing else breaks
  function buildHistoryContext() { return buildWorkflowContext() }

  function buildMemoryContext() {
    if (!Object.keys(memory).length) return null
    return Object.entries(memory).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n')
  }

  async function runStep() {
    setLoading(true); setError('')

    // Check token source once per session
    if (tokenSource === null) {
      const { data } = await supabase.from('user_api_keys').select('id').eq('is_active', true).limit(1)
      setTokenSource(data?.length ? 'user' : 'platform')
    }

    // ── API Call step ──────────────────────────────────────────────────────────
    if (isApiCallStep) {
      try {
        const previousOutput = results[stepIndex - 1] || inputs[stepIndex] || ''
        const fill = (t) => t?.replace(/\{\{previous_output\}\}/gi, previousOutput) || ''
        const { data: { session } } = await supabase.auth.getSession()

        const res = await fetch(`${API_URL}/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            method: current.api_method || 'GET',
            url: fill(current.api_url),
            body: current.api_body ? fill(current.api_body) : undefined,
            headers: current.api_headers ? JSON.parse(current.api_headers) : undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `API returned ${res.status}`)

        const resultText = typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2)
        setResults(p => ({ ...p, [stepIndex]: resultText }))
        if (!isLast) setInputs(p => ({ ...p, [stepIndex + 1]: resultText }))
        const { error: historyError } = await supabase.from('run_history').insert({ user_id: user.id, app_id: null, app_name: current.app_name, input: fill(current.api_url), result: resultText, flow_id: flow.id, flow_name: flow.name })
        if (historyError) toast(`Step completed, but wasn't saved to history: ${historyError.message}`, 'error')
        if (!isLast) setConnecting(true)
      } catch (e) { setError(e.message); toast(e.message, 'error') }
      finally { setLoading(false); setConnecting(false) }
      return
    }

    // ── AI App step ────────────────────────────────────────────────────────────
    const stepInput = buildStepInput()
    if (!stepInput.trim()) return

    // Capture source data into workflow context before running
    const fields = effectiveStepFields || []
    const vals = formValues[stepIndex] || {}
    if (fields.length) {
      setWfContext(prev => ({
        ...prev,
        source: { ...prev.source, [stepIndex]: Object.fromEntries(fields.map(f => [f.id, vals[f.id] || ''])) }
      }))
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const appData = currentApp
        || (await supabase.from('apps').select('system_prompt, ai_provider, ai_model, app_type, form_schema').eq('id', current.app_id).single()).data

      // Auto-select best model for this task (respecting workspace default_provider)
      const workspaceProvider = flow.default_provider || 'auto'
      let chosenProvider = appData?.ai_provider || 'claude'
      let chosenModel = appData?.ai_model || null
      if (workspaceProvider !== 'auto') {
        chosenProvider = workspaceProvider
        chosenModel = null // use provider default
      } else {
        try {
          const selRes = await fetch(`${API_URL}/select-model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
            body: JSON.stringify({ system_prompt: appData?.system_prompt, input: stepInput, provider: appData?.ai_provider || 'claude' }),
          })
          if (selRes.ok) {
            const sel = await selRes.json()
            chosenModel = sel.model
            toast(`🤖 ${sel.label}`, 'info', 2000)
          }
        } catch {}
      }

      // Fetch last 3 prior responses for this app to avoid repetition
      let priorResponses = []
      if (current.app_id) {
        const { data: history } = await supabase
          .from('run_history')
          .select('result')
          .eq('app_id', current.app_id)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(3)
        if (history) priorResponses = history.map(h => h.result).filter(Boolean).reverse()
      }
      const historyContext = buildHistoryContext()
      const memoryContext = buildMemoryContext()

      // Fetch Knowledge Vault entries if the workflow has it enabled
      let knowledgeContext = ''
      if (flow.use_knowledge_vault) {
        const { data: kvEntries } = await supabase
          .from('knowledge_vault')
          .select('title, content')
          .eq('user_id', user.id)
          .limit(12)
        if (kvEntries?.length) {
          knowledgeContext = kvEntries.map(e => `### ${e.title}\n${e.content}`).join('\n\n')
        }
      }

      const blocks = []
      if (flow.gpt_instructions) blocks.push(`You are acting as part of "${flow.gpt_name || 'this workflow\'s dedicated assistant'}" — a standing intelligence that governs every app in this workflow. Follow these standing instructions for every response, in addition to your normal role:\n${flow.gpt_instructions}`)
      if (knowledgeContext) blocks.push(`Company Knowledge Vault — use this information to inform your response. Prioritise it over generic assumptions:\n\n${knowledgeContext}`)
      if (memoryContext) blocks.push(`Known facts about the user/subject, learned across this workflow over time — keep these actively in mind even if not repeated in the current input:\n${memoryContext}`)
      if (historyContext) blocks.push(`This app is one step in a multi-app workflow. Here is everything produced by earlier steps, in order — use it as context, and if your role is to compare/score/decide between them, do so explicitly:\n\n${historyContext}`)

      const { result: full, provider: runProvider, model: runModel, usage: runUsage } = await streamRun({
        app_id: current.app_id, input: stepInput, system_prompt: appData?.system_prompt,
        ai_provider: chosenProvider,
        ai_model: chosenModel || null,
        user_context: blocks.length ? blocks.join('\n\n---\n\n') : undefined,
        temperature: 1.1,
        prior_responses: priorResponses.length ? priorResponses : undefined,
      }, session, val => setResults(p => ({ ...p, [stepIndex]: val })))

      setStepModels(p => ({ ...p, [stepIndex]: { provider: runProvider, model: runModel, usage: runUsage } }))

      const { error: historyError } = await supabase.from('run_history').insert({
        user_id: user.id, app_id: current.app_id, app_name: current.app_name, input: stepInput, result: full,
        flow_id: flow.id, flow_name: flow.name,
        input_tokens: runUsage?.input_tokens ?? null, output_tokens: runUsage?.output_tokens ?? null,
      })
      if (historyError) toast(`Step completed, but wasn't saved to history: ${historyError.message}`, 'error')

      // Validate output quality before storing in workflow context
      const outputValid = full?.trim().length > 30 && !full.startsWith('Backend error') && !full.startsWith('Error:')
      const outputStatus = !full?.trim() ? 'empty' : full.trim().length < 30 ? 'too_short' : full.startsWith('Backend error') || full.startsWith('Error:') ? 'error' : 'valid'
      if (outputStatus !== 'valid') {
        toast(`⚠ Step output may be low quality (${outputStatus}) — review before continuing`, 'warn', 4000)
      }

      // Store validated output in shared workflow context
      if (outputValid) {
        setWfContext(prev => ({
          ...prev,
          derived: { ...prev.derived, [stepIndex]: { stepName: current.app_name, output: full, status: outputStatus } }
        }))
      }

      // Pre-fill next step's textarea (if it's not native, it can use this; native steps see it via the context block)
      if (!isLast) setInputs(p => ({ ...p, [stepIndex + 1]: full }))

      setLoading(false)
      if (!isLast) setConnecting(true)
      const facts = await extractFacts(full, session)
      if (Object.keys(facts).length) {
        setMemory(prevMem => {
          const merged = mergeMemory(prevMem, facts)
          setProvenance(prevProv => {
            const mergedProv = { ...prevProv }
            const now = new Date().toISOString()
            for (const key of Object.keys(facts)) mergedProv[key] = { step_name: current.app_name, step_index: stepIndex, updated_at: now }
            supabase.from('flows').update({ memory: merged, memory_provenance: mergedProv }).eq('id', flow.id)
              .then(({ error }) => { if (error) toast(`Learned facts weren't saved: ${error.message}`, 'error') })
            return mergedProv
          })
          return merged
        })
      }
    } catch (e) { setError(e.message); toast(e.message, 'error') }
    finally { setLoading(false); setConnecting(false) }
  }

  // Next-best-action: pull this workflow step out as its own reusable app,
  // rather than it only ever existing bundled inside this one workflow.
  async function saveStepAsApp() {
    const stepApp = stepAppData[stepIndex]
    if (!stepApp) return
    setSavingTemplate(true)
    const { data, error } = await duplicateApp({
      name: current.app_name, emoji: current.app_emoji,
      description: `Extracted from the "${flow.name}" workflow.`,
      ...stepApp,
    }, user.id)
    setSavingTemplate(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Saved as "${data.name}" — find it in My Apps to customize it`, 'success', 4000)
  }

  function saveFactEdit(key) {
    setMemory(prevMem => {
      const merged = { ...prevMem }
      if (editValue.trim() === '') delete merged[key]
      else merged[key] = editValue.trim()
      setProvenance(prevProv => {
        const mergedProv = { ...prevProv }
        if (!(key in merged)) delete mergedProv[key]
        else mergedProv[key] = { step_name: 'manually corrected', step_index: null, updated_at: new Date().toISOString() }
        supabase.from('flows').update({ memory: merged, memory_provenance: mergedProv }).eq('id', flow.id)
          .then(({ error }) => { if (error) toast(`Edit wasn't saved: ${error.message}`, 'error') })
        return mergedProv
      })
      return merged
    })
    setEditingFact(null)
  }

  function deleteFact(key) {
    setMemory(prevMem => {
      const merged = { ...prevMem }
      delete merged[key]
      setProvenance(prevProv => {
        const mergedProv = { ...prevProv }
        delete mergedProv[key]
        supabase.from('flows').update({ memory: merged, memory_provenance: mergedProv }).eq('id', flow.id)
          .then(({ error }) => { if (error) toast(`Delete wasn't saved: ${error.message}`, 'error') })
        return mergedProv
      })
      return merged
    })
  }

  // Guard: flow has no steps (template apps not found in DB)
  if (steps.length === 0) return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-md p-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-white text-lg font-bold mb-2">No steps found</h2>
        <p className="text-slate-400 text-sm mb-2">This workflow has no app steps configured, or the apps it references were not found in your library.</p>
        <p className="text-slate-400 text-xs mb-6">Try editing the workflow to add steps, or reinstall the template after the required apps have been created.</p>
        <button onClick={onClose} className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white px-6 py-2.5 rounded-xl font-medium transition-colors">Close</button>
      </div>
    </div>
  )

  if (allDone) return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="relative bg-[#121829] border border-white/18 rounded-2xl w-full max-w-md p-8 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#6C5CE7]/10 via-transparent to-[#E84393]/10 pointer-events-none" />
        <div className="relative">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-lg shadow-[#6C5CE7]/20"
            style={{ background: 'linear-gradient(135deg, #6C5CE7, #E84393)' }}>🎉</div>
          <h2 className="text-white text-xl font-bold mb-2">Workflow complete!</h2>
          <p className="text-slate-400 text-sm mb-2">All {steps.length} steps finished. Results saved to your history.</p>
          {(() => {
            const totals = Object.values(stepModels).reduce((acc, s) => ({
              input: acc.input + (s.usage?.input_tokens || 0),
              output: acc.output + (s.usage?.output_tokens || 0),
            }), { input: 0, output: 0 })
            return (totals.input || totals.output) ? (
              <p className="text-[11px] text-slate-500 mb-6" title="Total tokens used across all steps">
                ↑{totals.input.toLocaleString()} in · ↓{totals.output.toLocaleString()} out tokens
              </p>
            ) : <div className="mb-4" />
          })()}
          {flow.integration_webhook_url && (
            <p className="text-xs mb-4">
              {sendStatus === 'sending' && <span className="text-slate-400">Sending to integration...</span>}
              {sendStatus === 'sent' && <span className="text-green-400">✓ Sent to integration</span>}
              {sendStatus === 'error' && (
                <button onClick={() => { setSendStatus('idle') }} className="text-red-400 hover:text-red-300">⚠ Failed to send — tap to retry</button>
              )}
            </p>
          )}
          <div className="flex flex-col gap-2 items-center">
            <div className="flex gap-2 justify-center">
              <ExportActions
                result={steps.map((s, i) => `## ${i + 1}. ${s.app_name}\n\n${results[i] || ''}`).join('\n\n---\n\n')}
                title={`${flow.name} — Full workflow results`}
                buttonLabel="⬇ Export all"
                buttonClassName="bg-[#1A2038] hover:bg-[#222840] text-slate-300 text-sm px-6 py-2.5 rounded-xl font-medium transition-colors"
                align="left"
              />
              <button onClick={onClose} className="bg-gradient-to-r from-[#6C5CE7] to-[#8B7CF6] hover:from-[#7D6FF0] hover:to-[#9C8FFF] text-white px-8 py-2.5 rounded-xl font-medium transition-all shadow-md shadow-[#6C5CE7]/20">Done</button>
            </div>
            <button onClick={() => { onClose(); onShowHistory?.() }}
              className="text-xs text-slate-400 hover:text-slate-300 transition-colors">
              🕘 View in Run History
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden" style={{ height: '85vh' }}>

        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/18 shrink-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-[#6C5CE7]/8 via-transparent to-[#E84393]/8 pointer-events-none" />
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
              style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.3), rgba(232,67,147,0.2))' }}>{flow.emoji}</div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-white font-semibold">{flow.name}</p>
                {flow.gpt_name && (
                  <span className="text-[9px] text-[#A29BFE] bg-[#6C5CE7]/15 px-2 py-0.5 rounded-full font-medium">🧠 {flow.gpt_name}</span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Step {stepIndex + 1} of {steps.length}
              </p>
            </div>
          </div>

          <div className="relative flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[10px]">
              {tokenSource === 'user'
                ? <span className="text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">🔑 Your API key</span>
                : tokenSource === 'platform'
                  ? <span className="text-[#A29BFE] bg-[#6C5CE7]/10 px-2 py-0.5 rounded-full">⚡ Aistrix credits</span>
                  : null
              }
            </div>
            <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl leading-none">✕</button>
          </div>
        </div>

        {/* Step progress */}
        <div className="px-6 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-0">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1 relative">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-all shrink-0
                    ${i < stepIndex ? 'bg-green-500 border-green-500 text-white'
                    : i === stepIndex && s.step_type === 'human_approval' ? 'bg-amber-500 border-amber-500 text-white'
                    : i === stepIndex ? 'bg-[#6C5CE7] border-[#6C5CE7] text-white'
                    : s.step_type === 'human_approval' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-[#1A2038] border-white/18 text-slate-400'}`}>
                    {i < stepIndex ? '✓' : s.step_type === 'human_approval' ? '✋' : s.app_emoji || i + 1}
                  </div>
                  {((i === stepIndex && loading) || (connecting && i === stepIndex - 1)) && (
                    <span className="absolute -top-1.5 -right-1.5 text-sm animate-pulse">🧠</span>
                  )}
                  <span className="text-[9px] text-slate-300 w-14 text-center truncate leading-tight">{s.app_name}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 mb-4 ${i < stepIndex ? 'bg-green-500' : 'bg-white/8'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 min-h-0 px-6 pb-2 space-y-4">
          {Object.keys(memory).length > 0 && (
            <div className="bg-[#6C5CE7]/8 border border-[#6C5CE7]/20 rounded-xl p-4">
              <p className="text-[10px] text-[#A29BFE] font-semibold uppercase tracking-wide mb-2">🧠 Workflow mind — learned facts, evolves with every run. Click a fact to correct it.</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(memory).map(([k, v]) => {
                  const prov = provenance[k]
                  const display = Array.isArray(v) ? v.join(', ') : v
                  return editingFact === k ? (
                    <span key={k} className="flex items-center gap-1 bg-[#1A2038] border border-[#6C5CE7]/40 rounded-lg px-2 py-1">
                      <span className="text-[11px] text-slate-300">{k}:</span>
                      <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveFactEdit(k); if (e.key === 'Escape') setEditingFact(null) }}
                        className="text-[11px] bg-transparent text-white focus:outline-none w-32" />
                      <button onClick={() => saveFactEdit(k)} className="text-green-400 text-xs hover:text-green-300">✓</button>
                      <button aria-label="Cancel edit" onClick={() => setEditingFact(null)} className="text-slate-400 text-xs hover:text-white">✕</button>
                    </span>
                  ) : (
                    <span key={k} title={prov ? `Learned from ${prov.step_name}${prov.updated_at ? ` · ${new Date(prov.updated_at).toLocaleDateString()}` : ''}` : undefined}
                      className="group/fact flex items-center gap-1 text-[11px] bg-[#1A2038] text-slate-300 pl-2.5 pr-1 py-1 rounded-lg hover:border hover:border-[#6C5CE7]/40">
                      <span className="text-slate-400">{k}:</span> {display}
                      <button onClick={() => { setEditingFact(k); setEditValue(display) }}
                        className="ml-1 text-slate-400 hover:text-white opacity-0 group-hover/fact:opacity-100 transition-opacity px-1">✏️</button>
                      <button aria-label={`Delete fact ${k}`} onClick={() => deleteFact(k)}
                        className="text-slate-400 hover:text-red-400 opacity-0 group-hover/fact:opacity-100 transition-opacity px-1">✕</button>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {stepIndex > 0 && !isApprovalStep && (
            <div className="bg-[#09101F] border border-white/18 rounded-xl p-4">
              <p className="text-[10px] text-[#6C5CE7] font-semibold uppercase tracking-wide mb-2">
                🧠 Workflow memory — this step sees all {stepIndex} earlier output{stepIndex > 1 ? 's' : ''}
              </p>
              <div className="space-y-2 max-h-28 overflow-y-auto">
                {steps.slice(0, stepIndex).map((s, i) => results[i] !== undefined && (
                  <div key={i} className="text-xs leading-relaxed">
                    <span className="text-slate-400 font-medium">{s.app_emoji} {s.app_name}: </span>
                    <span className="text-slate-400">{results[i].slice(0, 160)}{results[i].length > 160 ? '...' : ''}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">The immediate previous output is also pre-filled into the input below — edit it freely.</p>
            </div>
          )}

          {isApprovalStep ? (
            <div className="space-y-4">
              {/* Approval gate header */}
              <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
                <span className="text-2xl shrink-0">✋</span>
                <div>
                  <p className="text-amber-300 font-semibold text-sm">{current.app_name}</p>
                  <p className="text-amber-200/70 text-xs mt-0.5">
                    {current.approval_type === 'review' && 'Review the output below and approve or reject before the workflow continues.'}
                    {current.approval_type === 'edit' && 'Edit the output below before it passes to the next step.'}
                    {current.approval_type === 'assign' && 'Assign this output to a teammate for review, then approve to continue.'}
                  </p>
                </div>
              </div>

              {/* Previous output display / editable */}
              <div>
                <p className="text-xs text-slate-400 font-medium mb-2">Output from previous step</p>
                {current.approval_type === 'edit' ? (
                  <textarea
                    className="w-full bg-[#1A2038] border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-white resize-none focus:outline-none focus:border-amber-400 transition-colors"
                    rows={6}
                    value={approvalEdits[stepIndex] ?? approvalPreviousOutput()}
                    onChange={e => setApprovalEdits(p => ({ ...p, [stepIndex]: e.target.value }))}
                  />
                ) : (
                  <div className="bg-[#1A2038] border border-white/18 rounded-xl p-4 text-sm text-slate-300 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                    {approvalPreviousOutput() || <span className="text-slate-500 italic">No output from previous step yet.</span>}
                  </div>
                )}
              </div>

              {/* Assign to teammate fields */}
              {current.approval_type === 'assign' && (
                <div className="space-y-2">
                  <input
                    type="email"
                    placeholder="Teammate's email address"
                    value={assignEmail}
                    onChange={e => setAssignEmail(e.target.value)}
                    className="w-full bg-[#1A2038] border border-white/18 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
                  />
                  <textarea
                    placeholder="Add a note for your teammate (optional)"
                    value={assignNote}
                    onChange={e => setAssignNote(e.target.value)}
                    rows={2}
                    className="w-full bg-[#1A2038] border border-white/18 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-amber-400 transition-colors"
                  />
                  <a
                    href={assignEmail ? `mailto:${assignEmail}?subject=Review needed: ${encodeURIComponent(flow.name)}&body=${encodeURIComponent(`Hi,\n\nPlease review this output from the "${flow.name}" workflow:\n\n${approvalPreviousOutput()}\n\n${assignNote ? `Note: ${assignNote}\n\n` : ''}Thanks`)}` : undefined}
                    onClick={e => { if (!assignEmail) { e.preventDefault(); toast('Enter a teammate email first', 'error') } }}
                    className="inline-flex items-center gap-2 text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 px-4 py-2 rounded-lg transition-all">
                    📧 Open email to teammate
                  </a>
                </div>
              )}

              {/* Reject form */}
              {showRejectForm && (
                <div className="space-y-2">
                  <input
                    autoFocus
                    placeholder="Reason for rejection (optional)"
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') rejectWorkflow(); if (e.key === 'Escape') setShowRejectForm(false) }}
                    className="w-full bg-[#1A2038] border border-red-500/30 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-400 transition-colors"
                  />
                  <div className="flex gap-2">
                    <button onClick={rejectWorkflow} className="text-xs bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg transition-all">Confirm Reject & Stop</button>
                    <button onClick={() => setShowRejectForm(false)} className="text-xs text-slate-400 hover:text-white px-3 py-2 transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div>
            <div className="flex justify-center mb-3">
            <div className="inline-flex items-center gap-1.5 bg-[#6C5CE7]/15 border border-[#6C5CE7]/40 text-[#a89cf7] text-xs font-semibold px-3 py-1 rounded-full">
              {current.app_emoji} {current.app_name}
            </div>
            </div>
            {isApiCallStep ? (
              <div className="bg-[#0984E3]/8 border border-[#0984E3]/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[#0984E3] bg-[#0984E3]/15 px-2 py-0.5 rounded">{current.api_method}</span>
                  <code className="text-xs text-slate-300 truncate flex-1">{current.api_url}</code>
                </div>
                {stepIndex > 0 && (
                  <p className="text-[11px] text-slate-300">
                    <span className="text-[#0984E3]">{'{{previous_output}}'}</span> will be replaced with the output from step {stepIndex}.
                  </p>
                )}
                <p className="text-[11px] text-slate-300">This step runs automatically — no input needed.</p>
              </div>
            ) : hasStepFields ? (
              <div className="space-y-3">
                {(effectiveStepFields || []).map(f => {
                  const suggestions = (f.placeholder || '').includes('e.g.')
                    ? (f.placeholder || '').replace(/^.*e\.g\.\s*/i, '').split(/\s*[\/,]\s*/).map(s => s.trim()).filter(Boolean)
                    : []
                  const listId = `dl-${stepIndex}-${f.id}`
                  return (
                  <div key={f.id}>
                    <label className="block text-xs text-slate-300 font-medium mb-1">
                      {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
                    </label>
                    <input
                      className="w-full bg-[#1A2038] border border-white/18 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                      placeholder={f.placeholder || `Enter ${f.label.toLowerCase()}…`}
                      value={(formValues[stepIndex] || {})[f.id] || ''}
                      onChange={e => setFormValues(p => ({ ...p, [stepIndex]: { ...(p[stepIndex] || {}), [f.id]: e.target.value } }))}
                      spellCheck={true}
                      list={suggestions.length ? listId : undefined}
                    />
                    {suggestions.length > 0 && (
                      <datalist id={listId}>
                        {suggestions.map(s => <option key={s} value={s} />)}
                      </datalist>
                    )}
                  </div>
                  )
                })}
                <div className="flex items-center justify-between mt-1">
                  {stepIndex > 0 && results[stepIndex - 1]
                    ? <p className="text-[11px] text-slate-500">Previous step output is also available as context.</p>
                    : <span />
                  }
                  <button
                    onClick={() => {
                      const sample = {}
                      for (const f of effectiveStepFields || []) {
                        const eg = (f.placeholder || '').match(/e\.g\.\s*([^/,]+)/i)
                        if (eg) sample[f.id] = eg[1].trim()
                      }
                      setFormValues(p => ({ ...p, [stepIndex]: sample }))
                    }}
                    className="text-[11px] text-[#6C5CE7] hover:text-[#a89cf7] transition-colors underline underline-offset-2 shrink-0"
                  >
                    Try with sample data
                  </button>
                </div>
              </div>
            ) : isNativeStep ? (
              <NativeStepForm
                schema={currentApp.form_schema}
                values={formValues[stepIndex] || {}}
                onChange={vals => setFormValues(p => ({ ...p, [stepIndex]: vals }))}
              />
            ) : (
              <textarea
                className="w-full bg-[#1A2038] border border-white/18 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-400 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors"
                rows={4}
                placeholder={currentApp ? `Enter input for ${current.app_name}…` : 'Loading…'}
                value={inputs[stepIndex] || ''}
                onChange={e => setInputs(p => ({ ...p, [stepIndex]: e.target.value }))}
                spellCheck={true}
                autoComplete="on"
              />
            )}
          </div>
          )}

          {!isApprovalStep && error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

          {!isApprovalStep && results[stepIndex] && (
            <div className="bg-[#1A2038] border border-white/22 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/18">
                <p className="text-[11px] text-slate-300 font-medium">Result</p>
                <div className="flex items-center gap-2">
                  {loading
                    ? <span className="text-[10px] text-slate-400 animate-pulse">⟳ Streaming…</span>
                    : <span className="text-[10px] text-green-400">✓ Complete</span>
                  }
                  {stepModels[stepIndex] && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400">
                      {stepModels[stepIndex].provider === 'openai' ? '🟢' : '🟣'} {shortModelName(stepModels[stepIndex].model)}
                    </span>
                  )}
                  {stepModels[stepIndex]?.usage && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400" title="Tokens used for this step">
                      ↑{stepModels[stepIndex].usage.input_tokens?.toLocaleString()} ↓{stepModels[stepIndex].usage.output_tokens?.toLocaleString()} tok
                    </span>
                  )}
                  <ExportActions result={results[stepIndex]} title={`${flow.name} — ${current.app_name}`} />
                  {current.app_id && stepAppData[stepIndex] && (
                    <button onClick={saveStepAsApp} disabled={savingTemplate}
                      title="Save this step as its own reusable app"
                      className="text-[10px] text-slate-400 hover:text-slate-300 disabled:opacity-50 transition-colors">
                      {savingTemplate ? '⟳ Saving...' : '💾 Save as app'}
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 text-sm text-slate-200 max-h-52 overflow-y-auto leading-relaxed prose-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{results[stepIndex]}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Credits bar */}
        {credits && !credits.unlimited && (
          <div className="px-6 py-2 border-b border-white/18 bg-[#09101F]/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400">⚡ Aistrix credits today</span>
              <span className="text-[10px] text-slate-400">{credits.daily_remaining} / {credits.daily_limit} remaining</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{
                  width: `${(credits.daily_used / credits.daily_limit) * 100}%`,
                  background: credits.daily_remaining < 20 ? '#EF4444' : credits.daily_remaining < 50 ? '#F59E0B' : '#6C5CE7'
                }} />
            </div>
            {credits.daily_remaining < 20 && (
              <p className="text-[10px] text-amber-400 mt-1">Running low — add your API key in Settings → Keys to get unlimited runs.</p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/18 flex items-center justify-between shrink-0">
          <button onClick={() => { setStepIndex(i => i - 1); setError(''); setShowRejectForm(false) }} disabled={stepIndex === 0}
            className="text-sm px-4 py-2 rounded-xl bg-[#1A2038] hover:bg-[#222840] disabled:opacity-30 text-slate-300 transition-colors">
            ← Back
          </button>
          {isApprovalStep ? (
            <div className="flex items-center gap-2">
              {!showRejectForm && (
                <button onClick={() => setShowRejectForm(true)}
                  className="text-sm px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 transition-colors">
                  ✕ Reject
                </button>
              )}
              <button onClick={() => { approveStep(); isLast ? setStepIndex(steps.length) : setStepIndex(i => i + 1) }}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm px-6 py-2 rounded-xl font-medium transition-colors">
                ✓ {current.approval_type === 'edit' ? 'Confirm & Continue' : current.approval_type === 'assign' ? 'Approve & Continue' : 'Approve & Continue'}
              </button>
            </div>
          ) : (!results[stepIndex] || loading) ? (
            <div className="flex items-center gap-3">
              {(() => {
                const score = getReadinessScore()
                const cfg = {
                  ready:      { color: '#00B894', icon: '✓', label: 'Ready'      },
                  incomplete: { color: '#FDCB6E', icon: '○', label: 'Incomplete' },
                  invalid:    { color: '#E17055', icon: '⚠', label: 'Too vague'  },
                }[score]
                return (
                  <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: cfg.color }}>
                    {cfg.icon} {cfg.label}
                  </span>
                )
              })()}
              <button onClick={runStep} disabled={loading || !isStepReady()}
                className="flex items-center gap-2 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-6 py-2 rounded-xl font-medium transition-colors">
                {loading ? <><span className="animate-spin inline-block">⟳</span> Running…</> : isApiCallStep ? `🔗 Call API` : `▶ Run ${current.app_name}`}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setResults(p => { const n = { ...p }; delete n[stepIndex]; return n }); setError('') }}
                className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-[#1A2038] hover:bg-[#222840] text-slate-300 transition-colors"
                title="Edit input and re-run this step"
              >
                ⟳ Re-run
              </button>
              <button onClick={() => isLast ? setStepIndex(steps.length) : setStepIndex(i => i + 1)}
                className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-6 py-2 rounded-xl font-medium transition-colors">
                {isLast ? '✓ Finish' : 'Next →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── AI Workflow Designer Panel (embedded inside FlowBuilderModal) ────────────
function AIDesignerPanel({ apps, domains, onApply }) {
  const [goal, setGoal] = useState('')
  const [selectedDomains, setSelectedDomains] = useState([])
  const [thinking, setThinking] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const [error, setError] = useState(null)
  const [runOutput, setRunOutput] = useState(null)
  const [running, setRunning] = useState(false)
  const [swapIdx, setSwapIdx] = useState(null)       // which step chip is open for swapping
  const [altScores, setAltScores] = useState({})     // app_id → score for current swap context
  const [scoringAlts, setScoringAlts] = useState(false)
  const swapRef = useRef(null)
  const inputRef = useRef(null)

  // Close swap popover on outside click
  useEffect(() => {
    function onDown(e) { if (swapRef.current && !swapRef.current.contains(e.target)) setSwapIdx(null) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  async function openSwap(idx) {
    if (swapIdx === idx) { setSwapIdx(null); return }
    setSwapIdx(idx)
    setAltScores({})
    if (!suggestion) return

    const step = suggestion.steps[idx]
    const prevStep = idx > 0 ? suggestion.steps[idx - 1] : null
    const nextStep = idx < suggestion.steps.length - 1 ? suggestion.steps[idx + 1] : null

    // Apps already used in this suggestion (excluding current step)
    const usedIds = new Set(suggestion.steps.filter((_, i) => i !== idx).map(s => s.app_id))
    const candidates = apps.filter(a => !usedIds.has(a.id) && a.id !== step.app_id)
    if (candidates.length === 0) return

    setScoringAlts(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const context = [
        prevStep ? `previous step: "${prevStep.app_name}"` : 'first step',
        `current step role: "${step.role}"`,
        nextStep ? `next step: "${nextStep.app_name}"` : 'last step',
      ].join(', ')
      const { result } = await streamRun({
        system_prompt: 'You are a workflow compatibility expert. Respond ONLY with valid JSON, no prose.',
        input: `Workflow goal: ${goal}\nStep context: ${context}\nRate each app as a replacement for "${step.app_name}" in this position.\nApps: ${candidates.map(a => a.name).join(', ')}\nReturn JSON: {"AppName": score} where score is 0-100. 100=perfect replacement, 70=good, 50=possible, 30=unlikely, 0=irrelevant.`,
        provider: 'claude',
      }, session)
      const match = result.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        const map = {}
        for (const [name, score] of Object.entries(parsed)) {
          const app = candidates.find(a => a.name.toLowerCase() === name.toLowerCase())
          if (app) map[app.id] = Number(score)
        }
        setAltScores(map)
      }
    } catch {}
    setScoringAlts(false)
  }

  function replaceStep(idx, newApp) {
    setSuggestion(prev => {
      const steps = [...prev.steps]
      steps[idx] = { app_id: newApp.id, app_name: newApp.name, app_emoji: newApp.emoji, role: steps[idx].role }
      return { ...prev, steps }
    })
    setSwapIdx(null)
    setAltScores({})
  }

  useEffect(() => { inputRef.current?.focus() }, [])

  function toggleDomain(id) {
    setSelectedDomains(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    )
    setSuggestion(null)
  }

  function filteredApps() {
    if (selectedDomains.length === 0) return apps
    return apps.filter(a => a.domain_id && selectedDomains.includes(a.domain_id))
  }

  async function generate() {
    if (!goal.trim()) return
    setThinking(true); setSuggestion(null); setError(null); setRunOutput(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const pool = filteredApps()
      const domainNote = selectedDomains.length > 0
        ? `\nContext: the user is working in the domain of: ${domains.filter(d => selectedDomains.includes(d.id)).map(d => d.name).join(', ')}. Only suggest apps relevant to this domain.`
        : ''
      const appList = pool.map(a => `- ${a.name} (emoji: ${a.emoji}${a.domains?.name ? `, domain: ${a.domains.name}` : ''})`).join('\n')
      const systemPrompt = `You are an AI workflow designer. The user describes a goal and you suggest the best workflow using available apps.${domainNote}

Available apps:
${appList}

Respond ONLY with valid JSON (no markdown fences, no prose) in this exact shape:
{
  "name": "short workflow name",
  "emoji": "one emoji",
  "description": "one sentence describing what this workflow does",
  "explanation": "2-3 sentences explaining how the steps connect and what the user achieves",
  "steps": [
    { "app_name": "exact app name from the list", "role": "what this step does in 5 words" }
  ],
  "sampleInput": "a realistic one-paragraph sample input the user could paste to test this workflow"
}

Only include apps from the available list. Choose 2-5 steps. Match app names exactly. Do NOT suggest apps from unrelated domains.`

      const { result: full } = await streamRun({ system_prompt: systemPrompt, input: goal, provider: 'claude' }, session)
      const match = full.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No valid JSON in response')
      const parsed = JSON.parse(match[0])
      const resolved = (parsed.steps || []).map(s => {
        const found = apps.find(a => a.name.toLowerCase() === s.app_name.toLowerCase())
        return found
          ? { app_id: found.id, app_name: found.name, app_emoji: found.emoji, role: s.role }
          : { app_name: s.app_name, app_emoji: '🔧', role: s.role }
      }).filter(s => s.app_id)
      setSuggestion({ ...parsed, steps: resolved })
    } catch {
      setError('Could not generate a suggestion. Try rephrasing your goal.')
    } finally {
      setThinking(false)
    }
  }

  async function runSample() {
    if (!suggestion || running) return
    setRunning(true); setRunOutput('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const firstStep = suggestion.steps[0]
      if (!firstStep?.app_id) { setRunOutput('No runnable step found.'); setRunning(false); return }
      const { data: appData } = await supabase.from('apps').select('*').eq('id', firstStep.app_id).single()
      await streamRun({
        system_prompt: appData?.system_prompt || '',
        input: suggestion.sampleInput || goal,
        provider: appData?.ai_provider || 'claude',
        model: appData?.ai_model || null,
      }, session, t => { setRunOutput(t) })
    } catch (e) {
      setRunOutput('Sample run failed: ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="border border-[#6C5CE7]/25 bg-[#6C5CE7]/5 rounded-xl p-4 space-y-3">

      {/* Domain filter chips */}
      {domains.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Filter by domain <span className="normal-case text-slate-400">(optional — leave blank for all)</span></p>
          <div className="flex flex-wrap gap-1.5">
            {domains.map(d => {
              const active = selectedDomains.includes(d.id)
              return (
                <button
                  key={d.id}
                  onClick={() => toggleDomain(d.id)}
                  className={`flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border transition-all ${
                    active
                      ? 'text-white border-[#6C5CE7] bg-[#6C5CE7]/20'
                      : 'text-slate-400 border-white/18 bg-white/5 hover:border-white/20 hover:text-slate-300'
                  }`}
                >
                  <span>{d.emoji}</span>
                  <span>{d.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Goal input */}
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          rows={2}
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
          placeholder="Describe your goal, e.g. automate job applications — resume, cover letter, interview prep…"
          className="flex-1 bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors resize-none"
        />
        <button
          onClick={generate}
          disabled={!goal.trim() || thinking}
          className="px-4 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50 shrink-0"
          style={{ background: 'linear-gradient(135deg, #6C5CE7, #E84393)' }}>
          {thinking ? '…' : '✦ Design'}
        </button>
      </div>

      {/* Thinking */}
      {thinking && (
        <div className="flex items-center gap-2 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0s' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0.15s' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0.3s' }} />
          <span className="text-slate-400 text-xs ml-1">Analyzing requirements…</span>
        </div>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {/* Suggestion */}
      {suggestion && (
        <div className="space-y-3 animate-fade-in">
          <div className="bg-[#09101F] border border-white/8 rounded-xl p-3 space-y-2.5">
            {/* Name + description */}
            <div className="flex items-center gap-2">
              <span className="text-lg">{suggestion.emoji}</span>
              <div>
                <p className="text-white text-xs font-semibold">{suggestion.name}</p>
                <p className="text-[10px] text-slate-400">{suggestion.description}</p>
              </div>
            </div>
            {/* Step flow */}
            <div className="flex items-center gap-1 flex-wrap" ref={swapIdx !== null ? swapRef : null}>
              {suggestion.steps.map((s, i) => (
                <div key={i} className="flex items-center gap-1 relative">
                  <button
                    onClick={() => openSwap(i)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all text-left ${
                      swapIdx === i
                        ? 'bg-[#6C5CE7]/20 border-[#6C5CE7]/50'
                        : 'bg-[#1A2038] border-white/18 hover:border-[#6C5CE7]/40 hover:bg-[#222840]'
                    }`}
                    title="Click to swap this app"
                  >
                    <span className="text-xs">{s.app_emoji}</span>
                    <div>
                      <p className="text-white text-[10px] font-medium leading-tight">{s.app_name}</p>
                      <p className="text-[9px] text-slate-400 leading-tight">{s.role}</p>
                    </div>
                    <span className="text-[9px] text-slate-400 ml-0.5">⇅</span>
                  </button>

                  {/* Swap popover */}
                  {swapIdx === i && (
                    <div ref={swapRef} className="absolute top-full left-0 mt-1.5 z-50 bg-[#09101F] border border-[#6C5CE7]/30 rounded-xl shadow-2xl shadow-black/50 p-3 w-64">
                      <p className="text-[10px] text-[#A29BFE] font-semibold mb-2 uppercase tracking-wide">
                        Replace "{s.app_name}"
                      </p>
                      {scoringAlts ? (
                        <div className="flex items-center gap-2 py-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0.15s' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0.3s' }} />
                          <span className="text-[10px] text-slate-400">Scoring alternatives…</span>
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {apps
                            .filter(a => a.id !== s.app_id && !suggestion.steps.filter((_, si) => si !== i).find(st => st.app_id === a.id))
                            .map(a => ({ ...a, score: altScores[a.id] ?? null }))
                            .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
                            .map(a => {
                              const sc = a.score
                              const scoreColor = sc === null ? 'text-slate-400'
                                : sc >= 80 ? 'text-green-400'
                                : sc >= 60 ? 'text-yellow-400'
                                : sc >= 40 ? 'text-slate-400'
                                : 'text-slate-400'
                              return (
                                <button
                                  key={a.id}
                                  onClick={() => replaceStep(i, a)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#1A2038] transition-colors text-left group"
                                >
                                  <span className="text-sm shrink-0">{a.emoji}</span>
                                  <span className="text-[11px] text-slate-300 group-hover:text-white flex-1 min-w-0 truncate">{a.name}</span>
                                  {sc !== null && (
                                    <span className={`text-[10px] font-semibold shrink-0 ${scoreColor}`}>{sc}%</span>
                                  )}
                                </button>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )}

                  {i < suggestion.steps.length - 1 && <span className="flow-connector" style={{ width: '14px' }} />}
                </div>
              ))}
            </div>
            {/* Explanation */}
            <p className="text-[10px] text-slate-400 leading-relaxed border-t border-white/8 pt-2">{suggestion.explanation}</p>
          </div>

          {/* Sample input */}
          {suggestion.sampleInput && (
            <div className="bg-[#09101F] border border-white/8 rounded-xl p-3">
              <p className="text-[9px] text-slate-400 uppercase font-medium mb-1">Sample input</p>
              <p className="text-[10px] text-slate-300 leading-relaxed line-clamp-2">{suggestion.sampleInput}</p>
            </div>
          )}

          {/* Run output */}
          {runOutput && (
            <div className="bg-[#09101F] border border-[#6C5CE7]/20 rounded-xl p-3">
              <p className="text-[9px] text-[#A29BFE] uppercase font-medium mb-1">▶ Sample — {suggestion.steps[0]?.app_name}</p>
              <p className="text-[10px] text-slate-300 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">{runOutput}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={runSample} disabled={running}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20 text-slate-300 hover:text-white hover:border-white/20 transition-all disabled:opacity-50">
              {running ? '▶ Running…' : '▶ Run Sample'}
            </button>
            <button onClick={() => onApply(suggestion)}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
              style={{ background: 'linear-gradient(135deg, #6C5CE7, #8B5CF6)' }}>
              ✓ Apply to Workflow
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Flow Builder Modal ───────────────────────────────────────────────────────
const GPT_PROVIDERS = [
  { id: 'claude', label: '🟣 Claude' },
  { id: 'openai', label: '🟢 OpenAI' },
]

function ApiStepModal({ onSave, onCancel }) {
  const [label, setLabel]   = useState('API Call')
  const [method, setMethod] = useState('GET')
  const [url, setUrl]       = useState('')
  const [body, setBody]     = useState('')
  const [headers, setHeaders] = useState('')

  const inCls = 'w-full bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-lg flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <p className="text-white font-semibold">🔗 Add API Call Step</p>
          <button onClick={onCancel} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Step label</label>
            <input className={inCls} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Search Expedia" />
          </div>

          <div className="flex gap-2">
            <div className="shrink-0">
              <label className="text-xs text-slate-400 block mb-1">Method</label>
              <select className="bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#6C5CE7]"
                value={method} onChange={e => setMethod(e.target.value)}>
                {METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400 block mb-1">URL</label>
              <input className={inCls} value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://api.example.com/search?q={{previous_output}}" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Request body <span className="text-slate-400">(JSON, optional)</span>
            </label>
            <textarea className={inCls} rows={4} value={body} onChange={e => setBody(e.target.value)}
              placeholder={'{\n  "query": "{{previous_output}}",\n  "limit": 10\n}'} />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Headers <span className="text-slate-400">(JSON, optional)</span>
            </label>
            <textarea className={inCls} rows={2} value={headers} onChange={e => setHeaders(e.target.value)}
              placeholder={'{"Authorization": "Bearer YOUR_KEY"}'} />
          </div>

          <div className="bg-[#09101F] border border-white/18 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Template variables</p>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Use <code className="text-[#A29BFE] bg-[#6C5CE7]/10 px-1 rounded">{'{{previous_output}}'}</code> anywhere in the URL or body — it gets replaced with the output of the previous step at runtime.
            </p>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { if (!url.trim()) return; onSave({ step_type: 'api_call', app_name: label || 'API Call', app_emoji: '🔗', api_method: method, api_url: url.trim(), api_body: body.trim(), api_headers: headers.trim() }) }}
            disabled={!url.trim()}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-5 py-2.5 rounded-xl font-medium transition-colors">
            Add step
          </button>
          <button onClick={onCancel} className="bg-[#1A2038] text-slate-300 text-sm px-4 py-2.5 rounded-xl transition-colors hover:bg-[#222840]">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function FlowBuilderModal({ apps, domains, existingFlow, initialSteps, onSave, onCancel }) {
  const [name, setName] = useState(existingFlow?.name || '')
  const [emoji, setEmoji] = useState(existingFlow?.emoji || '⚡')
  const [description, setDescription] = useState(existingFlow?.description || '')
  const [steps, setSteps] = useState(existingFlow?.steps || initialSteps || [])
  const [showApiModal, setShowApiModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [showGpt, setShowGpt] = useState(!!(existingFlow?.gpt_name || existingFlow?.gpt_instructions))
  const [gptName, setGptName] = useState(existingFlow?.gpt_name || '')
  const [gptInstructions, setGptInstructions] = useState(existingFlow?.gpt_instructions || '')
  const [gptProvider, setGptProvider] = useState(existingFlow?.gpt_provider || 'claude')
  const [showIntegration, setShowIntegration] = useState(!!existingFlow?.integration_webhook_url)
  const [webhookUrl, setWebhookUrl] = useState(existingFlow?.integration_webhook_url || '')
  const [useKnowledge, setUseKnowledge] = useState(!!existingFlow?.use_knowledge_vault)
  const [defaultProvider, setDefaultProvider] = useState(existingFlow?.default_provider || 'claude')
  const [showAI, setShowAI] = useState(!existingFlow)
  const [usageMap, setUsageMap] = useState({})
  const [aiScores, setAiScores] = useState({})
  const [scoringAI, setScoringAI] = useState(false)
  const [showApprovalPicker, setShowApprovalPicker] = useState(false)
  const [editingStepIdx, setEditingStepIdx] = useState(null)
  const [fieldsDraft, setFieldsDraft] = useState([])
  const lastScoredRef = useRef(null)

  // Build usage frequency map from all existing flows
  useEffect(() => {
    supabase.from('flows').select('steps').then(({ data }) => {
      const map = {}
      for (const flow of data || []) {
        const fsteps = flow.steps || []
        for (let i = 0; i < fsteps.length - 1; i++) {
          const a = fsteps[i].app_id, b = fsteps[i + 1].app_id
          if (!a || !b) continue
          map[a] = map[a] || {}
          map[a][b] = (map[a][b] || 0) + 1
        }
      }
      setUsageMap(map)
    })
  }, [])

  // AI scoring for candidate apps whenever the last step changes
  useEffect(() => {
    if (steps.length === 0) { setAiScores({}); lastScoredRef.current = null; return }
    const lastId = steps[steps.length - 1].app_id
    if (lastId === lastScoredRef.current) return
    lastScoredRef.current = lastId

    const candidates = apps.filter(a => !steps.find(s => s.app_id === a.id) && !usageMap[lastId]?.[a.id])
    if (candidates.length === 0) return

    setScoringAI(true)
    const flowSoFar = steps.map(s => s.app_name).join(' → ')
    const lastApp = steps[steps.length - 1].app_name

    supabase.auth.getSession().then(({ data: { session } }) => {
      streamRun({
        system_prompt: 'You are a workflow compatibility expert. Respond ONLY with valid JSON, no prose.',
        input: `Current workflow: ${flowSoFar}\nLast step: "${lastApp}"\nRate each app as the NEXT step after "${lastApp}".\nApps: ${candidates.map(a => a.name).join(', ')}\nReturn JSON: {"AppName": score} where score is 0-90 (integer). 90=perfect fit, 70=good, 50=possible, 30=unlikely, 10=wrong order.`,
        provider: 'claude',
      }, session).then(({ result }) => {
        try {
          const match = result.match(/\{[\s\S]*\}/)
          if (match) {
            const parsed = JSON.parse(match[0])
            const scoreMap = {}
            for (const [name, score] of Object.entries(parsed)) {
              const app = candidates.find(a => a.name.toLowerCase() === name.toLowerCase())
              if (app) scoreMap[app.id] = Number(score)
            }
            setAiScores(scoreMap)
          }
        } catch {}
        setScoringAI(false)
      }).catch(() => setScoringAI(false))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apps is read for lookups, not a trigger; only re-run on steps/usageMap change
  }, [steps, usageMap])

  function getAppScore(app) {
    if (steps.length === 0) return null
    const lastId = steps[steps.length - 1].app_id
    const followers = usageMap[lastId] || {}
    const total = Object.values(followers).reduce((a, b) => a + b, 0)
    const count = followers[app.id] || 0
    if (count > 0 && total > 0) {
      return { score: Math.round(70 + (count / total) * 30), source: 'usage' }
    }
    if (aiScores[app.id] !== undefined) {
      return { score: aiScores[app.id], source: 'ai' }
    }
    return null
  }

  function getOrderWarning() {
    if (steps.length < 2) return null
    const last = steps[steps.length - 1]
    const prev = steps[steps.length - 2]
    const lastBeforePrev = usageMap[last.app_id]?.[prev.app_id] || 0
    const prevBeforeLast = usageMap[prev.app_id]?.[last.app_id] || 0
    if (lastBeforePrev > prevBeforeLast * 2 && lastBeforePrev >= 2) {
      return `"${last.app_name}" usually comes before "${prev.app_name}" in similar workflows`
    }
    return null
  }

  function applyAISuggestion(s) {
    setName(s.name); setEmoji(s.emoji); setDescription(s.description); setSteps(s.steps)
    setShowAI(false)
  }

  function skipAI() { setShowAI(false) }

  function addStep(app) {
    const key = app.name.toLowerCase()
    const defaultFields = APP_DEFAULT_FIELDS[key]
    setSteps(p => [...p, { app_id: app.id, app_name: app.name, app_emoji: app.emoji, ...(defaultFields ? { step_fields: defaultFields } : {}) }])
  }
  function addApiStep(cfg) { setSteps(p => [...p, cfg]); setShowApiModal(false) }
  const APPROVAL_TYPES = {
    review:  { label: 'Needs Approval',       emoji: '✋', desc: 'A human must approve before the workflow continues.' },
    edit:    { label: 'Edit Before Sending',  emoji: '✏️', desc: 'Review and edit the AI output before it passes to the next step.' },
    assign:  { label: 'Assign to Teammate',   emoji: '👤', desc: 'Route to a specific person for review via email.' },
  }
  function addApprovalStep(type) {
    const t = APPROVAL_TYPES[type]
    setSteps(p => [...p, { step_type: 'human_approval', approval_type: type, app_name: t.label, app_emoji: t.emoji }])
    setShowApprovalPicker(false)
  }
  function openFieldEditor(i) {
    const existing = steps[i].step_fields || []
    setFieldsDraft(existing.length ? existing.map(f => ({ ...f })) : [{ id: Date.now() + '', label: '', placeholder: '', required: false }])
    setEditingStepIdx(i)
  }
  function addDraftField() {
    setFieldsDraft(p => [...p, { id: Date.now() + '', label: '', placeholder: '', required: false }])
  }
  function updateDraftField(id, key, val) {
    setFieldsDraft(p => p.map(f => f.id === id ? { ...f, [key]: val } : f))
  }
  function removeDraftField(id) {
    setFieldsDraft(p => p.filter(f => f.id !== id))
  }
  function saveFieldEditor(i) {
    const valid = fieldsDraft.filter(f => f.label.trim())
    setSteps(p => p.map((s, idx) => idx === i ? { ...s, step_fields: valid.length ? valid : undefined } : s))
    setEditingStepIdx(null)
  }

  function removeStep(i) { setSteps(p => p.filter((_, idx) => idx !== i)) }
  function moveStep(i, dir) {
    const s = [...steps]; const j = i + dir
    if (j < 0 || j >= s.length) return
    ;[s[i], s[j]] = [s[j], s[i]]; setSteps(s)
  }

  async function save() {
    if (!name.trim() || steps.length < 1) return
    setSaving(true)
    await onSave({
      name: name.trim(), emoji, description: description.trim(), steps,
      gpt_name: showGpt ? gptName.trim() || null : null,
      gpt_instructions: showGpt ? gptInstructions.trim() || null : null,
      gpt_provider: showGpt ? gptProvider : null,
      integration_webhook_url: showIntegration ? webhookUrl.trim() || null : null,
      default_provider: defaultProvider,
      use_knowledge_vault: useKnowledge || null,
    })
    setSaving(false)
  }

  const inCls = 'w-full bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'
  const unusedApps = apps.filter(a => !steps.find(s => s.app_id === a.id) && (!search || a.name.toLowerCase().includes(search.toLowerCase())))

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/18 shrink-0">
          <p className="text-white font-semibold">{existingFlow ? 'Edit AI Workflow' : 'New AI Workflow'}</p>
          <button aria-label="Close" onClick={onCancel} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>

        {showAI ? (
          <div className="overflow-y-auto flex-1 min-h-0 px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-white font-semibold text-sm">✦ Design with AI</p>
                <p className="text-slate-400 text-xs mt-0.5">Describe your goal and AI will suggest a workflow</p>
              </div>
              <button onClick={skipAI} className="text-xs text-slate-400 hover:text-white border border-white/18 hover:border-white/20 px-3 py-1.5 rounded-lg transition-colors">
                Skip — build manually →
              </button>
            </div>
            <AIDesignerPanel apps={apps} domains={domains} onApply={applyAISuggestion} />
          </div>
        ) : (
        <div className="overflow-y-auto flex-1 min-h-0 px-6 py-5 space-y-5">

          {/* Name + emoji */}
          <div className="flex gap-3">
            <select className="bg-[#1A2038] border border-white/18 rounded-xl px-2 py-2.5 text-xl focus:outline-none focus:border-[#6C5CE7] w-14 text-center shrink-0"
              value={emoji} onChange={e => setEmoji(e.target.value)}>
              {EMOJIS.map(e => <option key={e}>{e}</option>)}
            </select>
            <input className={inCls} placeholder="Workflow name, e.g. Job Application Flow"
              value={name} onChange={e => setName(e.target.value)} />
          </div>
          <input className={inCls} placeholder="Description (optional)"
            value={description} onChange={e => setDescription(e.target.value)} />

          {/* Workspace GPT */}
          <div className="border border-[#6C5CE7]/20 bg-[#6C5CE7]/5 rounded-xl p-4">
            <button onClick={() => setShowGpt(v => !v)} className="w-full flex items-center justify-between">
              <span className="text-xs font-semibold text-[#A29BFE] uppercase tracking-wide">🧠 Workflow AI</span>
              <span className="text-slate-400 text-xs">{showGpt ? '− Remove' : '+ Add intelligence'}</span>
            </button>
            {!showGpt ? (
              <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                Give this workflow its own dedicated assistant — a name and standing instructions that guide every app inside it, on top of the shared memory.
              </p>
            ) : (
              <div className="space-y-2.5 mt-3">
                <input className={inCls} placeholder="GPT name, e.g. Career Coach GPT"
                  value={gptName} onChange={e => setGptName(e.target.value)} />
                <textarea className={inCls} rows={4}
                  placeholder="Standing instructions for every app in this workflow, e.g. 'Always write in a warm, encouraging tone. Always account for the user's accessibility needs and skills found in workflow memory. Prioritize concise, actionable output.'"
                  value={gptInstructions} onChange={e => setGptInstructions(e.target.value)} />
                <div className="flex gap-1.5">
                  {GPT_PROVIDERS.map(p => (
                    <button key={p.id} onClick={() => setGptProvider(p.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${gptProvider === p.id ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40 text-white' : 'bg-[#1A2038] border-white/18 text-slate-400 hover:text-white'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400">Applied as a system-level directive to every app run in this workflow.</p>
              </div>
            )}
          </div>

          {/* Integration */}
          <div className="border border-white/22 bg-[#1A2038]/40 rounded-xl p-4">
            <button onClick={() => setShowIntegration(v => !v)} className="w-full flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">🔗 Integration</span>
              <span className="text-slate-400 text-xs">{showIntegration ? '− Remove' : '+ Add export'}</span>
            </button>
            {!showIntegration ? (
              <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                Auto-send the final results somewhere else when this workflow finishes — Slack, a Google Sheet (via Zapier/Apps Script), or email (via Zapier/Make).
              </p>
            ) : (
              <div className="space-y-2.5 mt-3">
                <input className={inCls} placeholder="Webhook URL — Slack Incoming Webhook, Zapier, Make, or Google Apps Script"
                  value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} />
                <p className="text-[10px] text-slate-400">Sends a JSON payload ({'{ text, workspace, steps }'}) to this URL right after every run completes.</p>
              </div>
            )}
          </div>

          {/* Knowledge Vault */}
          <div className="border border-white/22 bg-[#1A2038]/40 rounded-xl p-4">
            <button onClick={() => setUseKnowledge(v => !v)} className="w-full flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">🧠 Company Knowledge</span>
              <span className={`w-9 h-5 rounded-full relative transition-colors ${useKnowledge ? 'bg-[#6C5CE7]' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${useKnowledge ? 'left-4' : 'left-0.5'}`} />
              </span>
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              {useKnowledge
                ? '✓ Knowledge Vault entries will be injected as context into every AI step in this workflow.'
                : 'Use company knowledge in this workflow — product docs, tone of voice, FAQs, and more.'}
            </p>
          </div>

          {/* AI Provider */}
          <div className="border border-white/22 bg-[#1A2038]/40 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">🤖 AI Provider</p>
            <p className="text-[11px] text-slate-300 mb-3">Which AI powers every app step in this workflow. Individual apps may override this.</p>
            <div className="flex gap-2">
              {[
                { id: 'claude', label: '🟣 Claude', sub: 'Anthropic' },
                { id: 'openai', label: '🟢 ChatGPT', sub: 'OpenAI' },
                { id: 'auto',   label: '⚡ Auto',   sub: 'Smart pick' },
              ].map(p => (
                <button key={p.id} onClick={() => setDefaultProvider(p.id)}
                  className={`flex-1 text-center py-2 rounded-xl border text-xs transition-all ${defaultProvider === p.id ? 'bg-[#6C5CE7]/20 border-[#6C5CE7]/50 text-white' : 'bg-[#1A2038] border-white/22 text-slate-400 hover:text-white'}`}>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{p.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Steps</p>
              {steps.length < 1 && <span className="text-[10px] text-slate-400">Add at least 1 app</span>}
            </div>
            {steps.length === 0 ? (
              <div className="border border-dashed border-white/18 rounded-xl p-8 text-center">
                <p className="text-slate-400 text-sm">Click apps below to add steps</p>
              </div>
            ) : (
              <div className="space-y-1">
                {steps.map((s, i) => (
                  <div key={i}>
                    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 group ${
                      s.step_type === 'api_call' ? 'bg-[#0984E3]/10 border border-[#0984E3]/20'
                      : s.step_type === 'human_approval' ? 'bg-amber-500/10 border border-amber-500/25'
                      : 'bg-[#1A2038]'}`}>
                      <span className="text-[11px] font-bold text-slate-400 w-4 text-center">{i + 1}</span>
                      <span className="text-base shrink-0">{s.app_emoji}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white">{s.app_name}</span>
                        {s.step_type === 'api_call' && (
                          <p className="text-[10px] text-[#0984E3] truncate mt-0.5">{s.api_method} {s.api_url}</p>
                        )}
                        {s.step_type === 'human_approval' && (
                          <p className="text-[10px] text-amber-400 mt-0.5">Human approval gate</p>
                        )}
                        {!s.step_type && (
                          <button onClick={() => editingStepIdx === i ? setEditingStepIdx(null) : openFieldEditor(i)}
                            className={`text-[10px] mt-0.5 transition-colors ${s.step_fields?.length ? 'text-[#A29BFE]' : 'text-slate-500 hover:text-[#A29BFE]'}`}>
                            {s.step_fields?.length ? `📋 ${s.step_fields.length} input field${s.step_fields.length > 1 ? 's' : ''} set` : '📋 Set input form'}
                          </button>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-white disabled:opacity-20 text-xs px-1.5 py-1 rounded transition-colors">↑</button>
                        <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="text-slate-400 hover:text-white disabled:opacity-20 text-xs px-1.5 py-1 rounded transition-colors">↓</button>
                        <button aria-label={`Remove step ${s.app_name}`} onClick={() => removeStep(i)} className="text-slate-400 hover:text-red-400 text-xs px-1.5 py-1 rounded transition-colors">✕</button>
                      </div>
                    </div>

                    {/* Inline field editor */}
                    {editingStepIdx === i && (
                      <div className="mt-2 ml-7 border border-[#6C5CE7]/30 bg-[#6C5CE7]/5 rounded-xl p-3 space-y-2" onClick={e => e.stopPropagation()}>
                        <p className="text-[11px] text-[#A29BFE] font-semibold">Define the input form runners will see for this step</p>
                        {fieldsDraft.map(f => (
                          <div key={f.id} className="flex items-center gap-2">
                            <input
                              placeholder="Field label *"
                              value={f.label}
                              onChange={e => updateDraftField(f.id, 'label', e.target.value)}
                              className="flex-1 bg-[#1A2038] border border-white/18 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]"
                            />
                            <input
                              placeholder="Placeholder hint"
                              value={f.placeholder}
                              onChange={e => updateDraftField(f.id, 'placeholder', e.target.value)}
                              className="flex-1 bg-[#1A2038] border border-white/18 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7]"
                            />
                            <button
                              onClick={() => updateDraftField(f.id, 'required', !f.required)}
                              title="Toggle required"
                              className={`text-[10px] px-2 py-1.5 rounded-lg border transition-all shrink-0 ${f.required ? 'bg-[#6C5CE7]/20 border-[#6C5CE7]/40 text-[#A29BFE]' : 'bg-transparent border-white/18 text-slate-500 hover:text-white'}`}>
                              req
                            </button>
                            <button onClick={() => removeDraftField(f.id)} className="text-slate-500 hover:text-red-400 text-xs px-1 transition-colors shrink-0">✕</button>
                          </div>
                        ))}
                        {fieldsDraft.length < 6 && (
                          <button onClick={addDraftField} className="text-[11px] text-[#6C5CE7] hover:text-[#A29BFE] transition-colors">+ Add field</button>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => saveFieldEditor(i)} className="text-xs bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white px-3 py-1.5 rounded-lg transition-colors">Save</button>
                          <button onClick={() => setEditingStepIdx(null)} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 transition-colors">Cancel</button>
                          {steps[i].step_fields?.length > 0 && (
                            <button onClick={() => { setSteps(p => p.map((s, idx) => idx === i ? { ...s, step_fields: undefined } : s)); setEditingStepIdx(null) }}
                              className="text-xs text-red-400/70 hover:text-red-400 px-3 py-1.5 transition-colors ml-auto">Remove form</button>
                          )}
                        </div>
                      </div>
                    )}
                    {i < steps.length - 1 && (
                      <div className="flex items-center gap-2 pl-11 py-0.5">
                        <div className={`w-px h-3 ${s.step_type === 'human_approval' ? 'bg-amber-500/30' : steps[i+1]?.step_type === 'human_approval' ? 'bg-amber-500/30' : 'bg-[#6C5CE7]/25'}`} />
                        <span className={`text-[9px] ${steps[i+1]?.step_type === 'human_approval' ? 'text-amber-500/60' : s.step_type === 'human_approval' ? 'text-amber-500/60' : 'text-[#6C5CE7]/50'}`}>
                          {steps[i+1]?.step_type === 'human_approval' ? 'needs approval →' : s.step_type === 'human_approval' ? 'approved →' : 'output → input'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {getOrderWarning() && (
                  <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2.5 mt-1">
                    <span className="text-amber-400 text-sm shrink-0">⚠</span>
                    <p className="text-[11px] text-amber-300 leading-relaxed">{getOrderWarning()} — consider reordering with the ↑↓ arrows.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* App picker */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Add steps</p>
                {steps.length > 0 && (
                  <span className="text-[10px] text-slate-400">
                    {scoringAI ? '⟳ scoring…' : '· sorted by compatibility'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button onClick={() => setShowApprovalPicker(v => !v)}
                    className="flex items-center gap-1.5 text-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 px-3 py-1.5 rounded-lg transition-all">
                    ✋ + Approval Gate
                  </button>
                  {showApprovalPicker && (
                    <div className="absolute right-0 top-full mt-1 w-64 bg-[#1A2038] border border-white/18 rounded-xl shadow-xl z-20 overflow-hidden">
                      {Object.entries(APPROVAL_TYPES).map(([type, t]) => (
                        <button key={type} onClick={() => addApprovalStep(type)}
                          className="w-full flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left">
                          <span className="text-lg shrink-0 mt-0.5">{t.emoji}</span>
                          <div>
                            <p className="text-sm text-white font-medium leading-tight">{t.label}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{t.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => setShowApiModal(true)}
                  className="flex items-center gap-1.5 text-xs bg-[#0984E3]/15 hover:bg-[#0984E3]/25 border border-[#0984E3]/30 text-[#0984E3] px-3 py-1.5 rounded-lg transition-all">
                  🔗 + API Call
                </button>
              </div>
            </div>
            <input className={`${inCls} mb-3`} placeholder="Search apps..."
              value={search} onChange={e => setSearch(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {unusedApps
                .map(a => ({ ...a, compat: getAppScore(a) }))
                .sort((a, b) => (b.compat?.score ?? -1) - (a.compat?.score ?? -1))
                .map(a => {
                  const s = a.compat
                  const scoreColor = !s ? 'text-slate-400'
                    : s.score >= 80 ? 'text-green-400'
                    : s.score >= 60 ? 'text-yellow-400'
                    : 'text-slate-400'
                  const borderColor = !s ? 'border-white/22'
                    : s.score >= 80 ? 'border-green-400/30'
                    : s.score >= 60 ? 'border-yellow-400/20'
                    : 'border-white/18'
                  return (
                    <button key={a.id} onClick={() => addStep(a)}
                      className={`flex items-center gap-1.5 text-xs bg-[#1A2038] hover:bg-[#222840] border ${borderColor} hover:border-[#6C5CE7]/50 text-slate-400 hover:text-white px-3 py-1.5 rounded-lg transition-all`}>
                      <span>{a.emoji}</span>
                      <span>{a.name}</span>
                      {s && (
                        <span className={`font-semibold ${scoreColor}`}>
                          {s.score}%{s.source === 'usage' ? '' : '~'}
                        </span>
                      )}
                    </button>
                  )
                })}
              {unusedApps.length === 0 && <p className="text-slate-400 text-xs">All apps added</p>}
            </div>
            {steps.length > 0 && (
              <p className="text-[10px] text-slate-400 mt-2">
                100–70% = used together in real workflows · 90%~ = AI-estimated · lower = likely incompatible
              </p>
            )}
          </div>
        </div>
        )}

        {!showAI && <div className="flex gap-2 px-6 py-4 border-t border-white/18 shrink-0">
          <button onClick={save} disabled={saving || !name.trim() || steps.length < 1}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-6 py-2.5 rounded-xl font-medium transition-colors">
            {saving ? 'Saving...' : existingFlow ? '✓ Save changes' : '✓ Create workflow'}
          </button>
          <button onClick={onCancel} className="bg-[#1A2038] hover:bg-[#222840] text-slate-300 text-sm px-4 py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
        </div>}
      </div>
      {showApiModal && <ApiStepModal onSave={addApiStep} onCancel={() => setShowApiModal(false)} />}
    </div>
  )
}

// ─── Share Modal ──────────────────────────────────────────────────────────────
function ShareModal({ flow, onClose }) {
  const [members, setMembers] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  useEffect(() => {
    supabase.from('flow_members').select('*').eq('flow_id', flow.id).order('created_at')
      .then(({ data }) => { setMembers(data || []); setLoading(false) })
  }, [flow.id])

  async function invite() {
    if (!email.trim()) return
    const { data, error } = await supabase.from('flow_members')
      .insert({ flow_id: flow.id, invited_email: email.trim().toLowerCase(), role }).select().single()
    if (error) { toast(error.message, 'error'); return }
    setMembers(p => [...p, data]); setEmail('')
    toast(`Invited ${data.invited_email}`, 'success')
  }

  async function removeMember(id) {
    const { error } = await supabase.from('flow_members').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setMembers(p => p.filter(m => m.id !== id))
  }

  const inCls = 'flex-1 bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/18">
          <p className="text-white font-semibold">👥 Share "{flow.name}"</p>
          <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex gap-2">
            <input className={inCls} placeholder="teammate@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            <select value={role} onChange={e => setRole(e.target.value)}
              className="bg-[#1A2038] border border-white/18 rounded-xl px-2 text-xs text-white focus:outline-none focus:border-[#6C5CE7]">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button onClick={invite} className="bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm px-4 rounded-xl font-medium transition-colors">Invite</button>
          </div>
          <div className="space-y-1.5">
            {loading ? (
              <p className="text-slate-400 text-xs">Loading members...</p>
            ) : members.length === 0 ? (
              <p className="text-slate-400 text-xs">No teammates added yet. Shared members can run this workflow and see its memory; editors can also edit steps.</p>
            ) : members.map(m => (
              <div key={m.id} className="flex items-center justify-between bg-[#1A2038] rounded-xl px-3 py-2">
                <div className="text-xs text-white">{m.invited_email} <span className="text-slate-400">· {m.role}</span></div>
                <button aria-label={`Remove ${m.invited_email}`} onClick={() => removeMember(m.id)} className="text-slate-400 hover:text-red-400 text-xs">✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function WebhookModal({ flow, onClose, onUpdated }) {
  const [token, setToken] = useState(flow.webhook_token || null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  const webhookUrl = token
    ? `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/webhooks/${token}`
    : null

  async function generate() {
    setLoading(true)
    const newToken = crypto.randomUUID()
    const { error } = await supabase.from('flows').update({ webhook_token: newToken }).eq('id', flow.id)
    setLoading(false)
    if (error) { toast(error.message, 'error'); return }
    setToken(newToken)
    onUpdated({ ...flow, webhook_token: newToken })
  }

  async function revoke() {
    setLoading(true)
    const { error } = await supabase.from('flows').update({ webhook_token: null }).eq('id', flow.id)
    setLoading(false)
    if (error) { toast(error.message, 'error'); return }
    setToken(null)
    onUpdated({ ...flow, webhook_token: null })
  }

  function copy() {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/18">
          <p className="text-white font-semibold">🔗 Webhook / API Trigger</p>
          <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">
            Send a <code className="bg-white/8 px-1 py-0.5 rounded text-[#A29BFE]">POST</code> request to this URL to trigger the workflow automatically — from Zapier, Make, your own code, or any HTTP client. The request body becomes the first step's input.
          </p>

          {token ? (
            <>
              <div className="bg-[#09101F] border border-[#0984E3]/30 rounded-xl p-3 flex items-center gap-2">
                <code className="text-xs text-[#A29BFE] flex-1 break-all leading-relaxed">{webhookUrl}</code>
                <button onClick={copy} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-[#0984E3]/15 hover:bg-[#0984E3]/25 text-[#0984E3] transition-colors font-medium">
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <div className="bg-[#1A2038] rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Example request</p>
                <pre className="text-[11px] text-slate-300 leading-relaxed overflow-x-auto whitespace-pre">{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Your trigger input here"}'`}</pre>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={generate} disabled={loading}
                  className="text-xs px-4 py-2 rounded-lg bg-[#1A2038] hover:bg-[#222840] text-slate-300 transition-colors">
                  ↻ Regenerate URL
                </button>
                <button onClick={revoke} disabled={loading}
                  className="text-xs px-4 py-2 rounded-lg text-red-400 hover:text-red-300 transition-colors">
                  Revoke
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-4">No webhook URL generated yet.</p>
              <button onClick={generate} disabled={loading}
                className="bg-[#0984E3] hover:bg-[#0873C4] disabled:opacity-50 text-white text-sm px-6 py-2.5 rounded-xl font-medium transition-colors">
                {loading ? 'Generating...' : '🔗 Generate Webhook URL'}
              </button>
            </div>
          )}

          <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3 text-[11px] text-amber-300/80 leading-relaxed">
            ⚠ Anyone with this URL can trigger the workflow. Revoke and regenerate if it's ever exposed.
          </div>
        </div>
      </div>
    </div>
  )
}

function ScheduleModal({ flow, userId, onClose, onSaved }) {
  const [schedule, setSchedule] = useState(null)
  const [frequency, setFrequency] = useState('daily')
  const [hourUtc, setHourUtc] = useState(9)
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [seedInput, setSeedInput] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => {
    supabase.from('flow_schedules').select('*').eq('flow_id', flow.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSchedule(data); setFrequency(data.frequency); setHourUtc(data.hour_utc)
          setDayOfWeek(data.day_of_week ?? 1); setSeedInput(data.seed_input || ''); setEnabled(data.enabled)
        }
        setLoading(false)
      })
  }, [flow.id])

  function nextRunAt() {
    const now = new Date()
    const next = new Date(now)
    next.setUTCHours(hourUtc, 0, 0, 0)
    if (frequency === 'weekly') {
      const daysAhead = (dayOfWeek - next.getUTCDay() + 7) % 7
      next.setUTCDate(next.getUTCDate() + daysAhead)
      if (next <= now) next.setUTCDate(next.getUTCDate() + 7)
    } else if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
    return next.toISOString()
  }

  async function save() {
    if (!seedInput.trim()) { toast('Add the input for the first step', 'error'); return }
    setSaving(true)
    const payload = {
      flow_id: flow.id, user_id: userId, frequency, hour_utc: hourUtc,
      day_of_week: frequency === 'weekly' ? dayOfWeek : null,
      seed_input: seedInput.trim(), enabled, next_run_at: nextRunAt(),
    }
    const { data, error } = schedule
      ? await supabase.from('flow_schedules').update(payload).eq('id', schedule.id).select().single()
      : await supabase.from('flow_schedules').insert(payload).select().single()
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(enabled ? 'Schedule saved' : 'Schedule saved (paused)', 'success')
    onSaved(data)
    onClose()
  }

  async function remove() {
    if (!schedule) { onClose(); return }
    const { error } = await supabase.from('flow_schedules').delete().eq('id', schedule.id)
    if (error) { toast(error.message, 'error'); return }
    onSaved(null)
    onClose()
  }

  const inCls = 'w-full bg-[#1A2038] border border-white/18 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#121829] border border-white/18 rounded-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/18">
          <p className="text-white font-semibold">⏰ Schedule "{flow.name}"</p>
          <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
        {loading ? (
          <p className="px-6 py-5 text-slate-400 text-xs">Loading...</p>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Runs the whole workflow unattended on a recurring basis, chaining each step's output into the next, same as a manual run. Results land in Run History and fire the integration webhook if one is set.
            </p>
            <div>
              <label className="text-[11px] text-slate-300 mb-1 block">Input for the first step</label>
              <textarea className={inCls} rows={3} placeholder="e.g. Pull this week's open support tickets..."
                value={seedInput} onChange={e => setSeedInput(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <select value={frequency} onChange={e => setFrequency(e.target.value)} className={inCls}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
              {frequency === 'weekly' && (
                <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))} className={inCls}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              )}
              <select value={hourUtc} onChange={e => setHourUtc(Number(e.target.value))} className={inCls}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00 UTC</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
              Enabled
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={saving}
                className="flex-1 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-50 text-white text-sm py-2.5 rounded-xl font-medium transition-colors">
                {saving ? 'Saving...' : 'Save schedule'}
              </button>
              {schedule && (
                <button onClick={remove} className="px-4 text-sm text-red-400 hover:text-red-300 transition-colors">Remove</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Workflow Tile (compact view) ─────────────────────────────────────────────
const TAB_VISIBLE = 2

function WorkflowTab({ flow, onRun, onEdit, onDelete, schedule, userId, role, lastRun }) {
  const steps = flow.steps || []
  const isOwner = !role || role === 'owner'
  const [startIdx, setStartIdx] = useState(0)
  const pageSteps = steps.slice(startIdx, startIdx + TAB_VISIBLE)
  const canPrev = startIdx > 0
  const canNext = startIdx + TAB_VISIBLE < steps.length
  const { done, total } = useTodayProgress(flow, userId)
  const isEmpty = steps.length === 0

  if (isEmpty) {
    return (
      <div className="group relative bg-[#121829] border border-amber-400/30 rounded-xl p-3 flex flex-col gap-2 min-h-[100px]">
        {isOwner && (
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="absolute top-1.5 right-1.5 text-[9px] text-slate-500 hover:text-red-400 transition-colors p-0.5">🗑</button>
        )}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md flex items-center justify-center text-sm shrink-0 bg-amber-400/10">{flow.emoji}</div>
          <p className="text-white text-xs font-semibold leading-snug flex-1 min-w-0 truncate">{flow.name}</p>
        </div>
        <p className="text-[9px] text-amber-400">⚠ No steps — apps not found in your library</p>
      </div>
    )
  }

  return (
    <div
      className="group relative bg-[#121829] border border-white/20 hover:border-white/20 hover:bg-[#182030] hover:shadow-xl hover:shadow-black/30 rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-2"
      onClick={onRun}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRun() } }}
    >
      {/* Quick actions */}
      {isOwner && (
        <div className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center z-10">
          <button onClick={e => { e.stopPropagation(); onEdit() }}
            className="p-0.5 text-[9px] text-slate-400 hover:text-white transition-colors">✏️</button>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-0.5 text-[9px] text-slate-400 hover:text-red-400 transition-colors">🗑</button>
        </div>
      )}

      {/* Header: icon + name */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-sm shrink-0"
          style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.25), rgba(232,67,147,0.18))' }}>
          {flow.emoji}
        </div>
        <p className="text-white text-xs font-semibold leading-snug line-clamp-2 flex-1 min-w-0" title={flow.name}>{flow.name}</p>
      </div>

      {/* App flow chips */}
      <div className="flex items-center gap-1 overflow-hidden min-w-0">
        {pageSteps.map((s, i) => (
          <div key={startIdx + i} className="flex items-center gap-1 min-w-0" style={{ flexShrink: i === 0 ? 2 : 1 }}>
            <div className="flex items-center gap-1 bg-[#1A2038] border border-white/18 px-1.5 py-0.5 rounded-md min-w-0 overflow-hidden">
              {s.app_icon && <img src={s.app_icon} alt="" className="w-3 h-3 rounded-sm shrink-0" />}
              <span className="text-[9px] text-slate-200 truncate">{s.app_name}</span>
            </div>
            {i < pageSteps.length - 1 && (
              <span className="flow-connector" style={{ animationDelay: `${i * 0.5}s`, width: '14px' }} />
            )}
          </div>
        ))}
        {canNext && <span className="text-slate-400 text-[9px] shrink-0">…</span>}
      </div>

      {/* Last run hint */}
      <p className="text-[9px] text-slate-500">
        {lastRun ? `Last run ${timeAgo(lastRun.created_at)}` : 'Never run'}
      </p>

      {/* Bottom row */}
      <div className="flex items-center gap-1.5 mt-auto">
        <span className="text-[9px] text-slate-400 shrink-0">
          ⚡ {steps.length}
          {schedule?.enabled && <span className="text-amber-400 ml-1">⏰</span>}
          {flow.is_published && <span className="text-green-400 ml-1">●</span>}
        </span>
        <div className="flex items-center gap-1 flex-1 justify-center">
          <button onClick={e => { e.stopPropagation(); setStartIdx(i => Math.max(0, i - TAB_VISIBLE)) }}
            disabled={!canPrev}
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] text-slate-400 hover:text-white hover:bg-white/8 transition-all ${!canPrev ? 'opacity-25 cursor-default' : ''}`}>‹</button>
          <button onClick={e => { e.stopPropagation(); onRun() }}
            className="workflow-action-button relative overflow-hidden text-[10px] px-3 py-1 rounded-md font-semibold shrink-0 transition-all"
            style={{ background: 'linear-gradient(135deg, #6C5CE7, #8B5CF6)' }}>
            <span className="relative z-10">▶ Run</span>
            <span className="absolute inset-0 rounded-md" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 60%)', pointerEvents: 'none' }} />
          </button>
          <button onClick={e => { e.stopPropagation(); setStartIdx(i => Math.min(steps.length - TAB_VISIBLE, i + TAB_VISIBLE)) }}
            disabled={!canNext}
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] text-slate-400 hover:text-white hover:bg-white/8 transition-all ${!canNext ? 'opacity-25 cursor-default' : ''}`}>›</button>
        </div>
        <div className="shrink-0"><CircleProgress done={done} total={total} /></div>
      </div>
    </div>
  )
}

// ─── SVG circle progress indicator ──────────────────────────────────────────
function CircleProgress({ done, total }) {
  const r = 8
  const circ = 2 * Math.PI * r
  const pct = total > 0 ? done / total : 0
  const allDone = total > 0 && done === total
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0" title={total > 0 ? `${done}/${total} steps run today` : 'No runs today'}>
      {/* Track */}
      <circle cx="10" cy="10" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
      {/* Fill */}
      {done > 0 && (
        <circle cx="10" cy="10" r={r} fill="none"
          stroke={allDone ? '#22c55e' : '#6C5CE7'}
          strokeWidth="2.5"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 10 10)"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      )}
    </svg>
  )
}

// ─── Workspace Card ───────────────────────────────────────────────────────────
const STEP_VISIBLE = 3   // chips shown at once
const STEP_ADVANCE = 2   // how many new chips each arrow click reveals (overlap = 1)

function WorkspaceCard({ flow, onRun, onEdit, onDelete, onPublish, onShare, onSchedule, onWebhook, schedule, userId, role, lastRun, suggestStart }) {
  const steps = flow.steps || []
  const isOwner = !role || role === 'owner'
  const [startIdx, setStartIdx] = useState(0)
  const pageSteps = steps.slice(startIdx, startIdx + STEP_VISIBLE)
  const canPrev = startIdx > 0
  const canNext = startIdx + STEP_VISIBLE < steps.length
  const hasNextPage = canNext
  const { done, total } = useTodayProgress(flow, userId)

  const isEmpty = steps.length === 0
  const status = isEmpty ? 'incomplete'
    : schedule?.enabled ? 'scheduled'
    : flow.is_published ? 'published'
    : 'active'

  const STATUS_STYLES = {
    incomplete: { dot: 'bg-amber-400', label: 'Incomplete', labelClass: 'text-amber-400' },
    scheduled:  { dot: 'bg-blue-400',  label: 'Scheduled',  labelClass: 'text-blue-400'  },
    published:  { dot: 'bg-green-400', label: 'Published',  labelClass: 'text-green-400' },
    active:     { dot: 'bg-green-400', label: 'Active',     labelClass: 'text-green-400' },
  }
  const st = STATUS_STYLES[status]

  return (
    <div className={`relative border rounded-lg overflow-hidden transition-all group flex flex-col h-full ${
      isEmpty
        ? 'bg-[#121829] border-amber-400/30'
        : suggestStart
          ? 'bg-[#121829] border-[#6C5CE7]/60 shadow-lg shadow-[#6C5CE7]/15 hover:border-[#6C5CE7]/80 hover:bg-[#182030]'
          : 'bg-[#121829] border-white/20 hover:border-white/30 hover:bg-[#182030] hover:shadow-xl hover:shadow-black/30'
    }`}>
      {suggestStart && (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-center gap-1.5 bg-[#6C5CE7]/20 border-b border-[#6C5CE7]/30 py-1 z-10">
          <span className="text-[10px] text-[#a89cf7] font-semibold tracking-wide">✦ Start here — run this first</span>
        </div>
      )}
      <div className={`p-4 flex flex-col flex-1 relative ${suggestStart ? 'pt-8' : ''}`}>

        {/* 0-step guard — shown instead of normal content when workflow has no steps */}
        {isEmpty && (
          <div className="absolute inset-0 bg-amber-400/5 flex flex-col items-center justify-center p-4 text-center rounded-xl">
            <span className="text-2xl mb-2">⚠</span>
            <p className="text-amber-400 text-xs font-semibold mb-1">No steps installed</p>
            <p className="text-slate-400 text-[10px] leading-relaxed mb-3">
              The apps for this workflow weren't found in your library. Add the required apps, then delete and reinstall this workflow.
            </p>
            <button onClick={onDelete}
              className="text-[10px] text-slate-500 hover:text-red-400 underline underline-offset-2 transition-colors">
              Remove workflow
            </button>
          </div>
        )}

        {/* Normal card content */}
        {!isEmpty && (
          <>
            {/* Header: emoji + name + description + action icons */}
            <div className="flex items-start justify-between mb-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                  style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.28), rgba(232,67,147,0.18))' }}>
                  {flow.emoji}
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm leading-tight truncate">{flow.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate leading-snug">
                    {flow.description || steps.map(s => s.app_name).join(' → ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {isOwner && (
                  <>
                    <button onClick={onShare} title="Share" className="p-1 rounded-md text-xs text-slate-400 hover:text-white hover:bg-white/8 transition-colors">👥</button>
                    <button onClick={onSchedule} title="Schedule"
                      className={`p-1 rounded-md text-xs transition-colors hover:bg-white/8 ${schedule?.enabled ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'}`}>⏰</button>
                    <button onClick={onWebhook} title="Webhook / API trigger"
                      className={`p-1 rounded-md text-xs transition-colors hover:bg-white/8 ${flow.webhook_token ? 'text-[#0984E3]' : 'text-slate-400 hover:text-[#0984E3]'}`}>🔗</button>
                    <button onClick={onPublish} title={flow.is_published ? 'Unpublish' : 'Publish'}
                      className={`p-1 rounded-md text-xs transition-colors hover:bg-white/8 ${flow.is_published ? 'text-green-400' : 'text-slate-400 hover:text-green-400'}`}>🌐</button>
                  </>
                )}
                {(isOwner || role === 'editor') && (
                  <button onClick={onEdit} className="p-1 rounded-md text-xs text-slate-400 hover:text-white hover:bg-white/8 transition-colors">✏️</button>
                )}
                {isOwner && (
                  <button onClick={onDelete} className="p-1 rounded-md text-xs text-slate-400 hover:text-red-400 hover:bg-red-400/5 transition-colors">🗑</button>
                )}
              </div>
            </div>

            {/* Step flow — fades out on right to hint more chips */}
            <div className="relative overflow-hidden flex-1 mb-3 mt-1">
              <div className="flex items-center gap-1 overflow-hidden">
                {pageSteps.map((s, i) => (
                  <div key={startIdx + i} className="flex items-center gap-1 shrink-0">
                    <div className="flex items-center gap-1 bg-[#1A2038] border border-white/18 px-1.5 py-1 rounded-md">
                      <span className="text-[11px]">{s.app_emoji}</span>
                      <span className="text-[10px] text-slate-200 whitespace-nowrap">{s.app_name}</span>
                    </div>
                    {i < pageSteps.length - 1 && (
                      <span className="flow-connector" style={{ animationDelay: `${i * 0.5}s` }} />
                    )}
                  </div>
                ))}
              </div>
              {hasNextPage && (
                <div className="absolute right-0 top-0 bottom-0 w-10 pointer-events-none"
                  style={{ background: 'linear-gradient(to right, transparent, #121829)' }} />
              )}
            </div>

            {/* Metadata row: status · steps · last run · owner */}
            <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-2 flex-wrap">
              <span className={`flex items-center gap-1 ${st.labelClass}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                {st.label}
              </span>
              <span>·</span>
              <span>{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span>{lastRun ? `Last run ${timeAgo(lastRun.created_at)}` : 'Never run'}</span>
            </div>

            {/* Quality Score row */}
            {(() => {
              const allReady   = steps.length > 0 && steps.every(s => s.app_id)
              const hasTested  = !!lastRun
              const hasInputs  = steps.some(s => s.step_fields?.length)
              const connected  = !!(flow.webhook_token || flow.integration_webhook_url || schedule?.enabled)
              const badges = [
                allReady  && { label: 'Ready',     color: '#00B894' },
                hasTested && { label: 'Tested',    color: '#0984E3' },
                hasInputs && { label: 'Has inputs', color: '#6C5CE7' },
                connected && { label: 'Connected',  color: '#FDCB6E' },
              ].filter(Boolean)
              return badges.length > 0 ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {badges.map(b => (
                    <span key={b.label}
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md"
                      style={{ background: b.color + '18', color: b.color, border: `1px solid ${b.color}33` }}>
                      ✓ {b.label}
                    </span>
                  ))}
                </div>
              ) : null
            })()}

            {/* Bottom row: nav + Run button + progress */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 flex-1 justify-center">
                <button onClick={e => { e.stopPropagation(); setStartIdx(i => Math.max(0, i - STEP_ADVANCE)) }}
                  disabled={!canPrev}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-sm text-slate-400 hover:text-white bg-[#1A2038] hover:bg-white/10 border border-white/18 disabled:opacity-25 disabled:cursor-default transition-all shrink-0">
                  ‹
                </button>
                <button onClick={onRun}
                  className="workflow-action-button relative overflow-hidden text-xs px-5 py-1.5 rounded-lg font-semibold transition-all shrink-0"
                  style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.7) 0%, rgba(162,155,254,0.5) 40%, rgba(108,92,231,0.65) 100%)' }}>
                  <span className="relative z-10">▶ Run workflow</span>
                  <span className="absolute inset-0 rounded-lg" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%)', pointerEvents: 'none' }} />
                </button>
                <button onClick={e => { e.stopPropagation(); setStartIdx(i => Math.min(steps.length - STEP_VISIBLE, i + STEP_ADVANCE)) }}
                  disabled={!canNext}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-sm text-slate-400 hover:text-white bg-[#1A2038] hover:bg-white/10 border border-white/18 disabled:opacity-25 disabled:cursor-default transition-all shrink-0">
                  ›
                </button>
              </div>
              <div className="shrink-0">
                <CircleProgress done={done} total={total} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Quick Start Templates ────────────────────────────────────────────────────
const PACK_COLORS = {
  General: '#6C5CE7', Sales: '#00B894', HR: '#FDCB6E',
  Support: '#E17055', Finance: '#0984E3', Marketing: '#A29BFE', Founders: '#E84393',
}
const PACK_ICONS = {
  General: '⚡', Sales: '💰', HR: '👥',
  Support: '🎫', Finance: '📊', Marketing: '📢', Founders: '🚀',
}

function QuickStartTemplates({ apps, flows, onCreated, userId, deletedFlowId, onRunFlow, activePack }) {
  const [installing, setInstalling] = useState(null)
  const [installed, setInstalled] = useState({}) // { [tplName]: { flowId, stepCount, missingNames } }
  const [tested, setTested] = useState(new Set())   // tplNames with confirmed successful run
  const [testError, setTestError] = useState({})    // { [tplName]: true } when run closed without success
  const toast = useToast()

  useEffect(() => {
    setInstalled(prev => {
      const next = { ...prev }
      for (const tpl of QUICK_START_TEMPLATES) {
        const match = flows.find(f => f.name === tpl.name)
        if (match) {
          const steps = match.steps || []
          const installedNames = steps.map(s => s.app_name)
          const missingNames = tpl.appNames.filter(n => {
            const lower = n.toLowerCase()
            return !installedNames.some(installed =>
              installed?.toLowerCase() === lower ||
              installed?.toLowerCase().includes(lower) ||
              lower.includes(installed?.toLowerCase())
            )
          })
          next[tpl.name] = { flowId: match.id, stepCount: steps.length, missingNames }
        } else if (next[tpl.name] && !flows.find(f => f.id === next[tpl.name]?.flowId)) {
          delete next[tpl.name]
        }
      }
      return next
    })
  }, [flows])

  useEffect(() => {
    if (!deletedFlowId) return
    setInstalled(p => {
      const next = { ...p }
      for (const [name, data] of Object.entries(next)) {
        if (data?.flowId === deletedFlowId) delete next[name]
      }
      return next
    })
  }, [deletedFlowId])

  async function installMissingApps(tpl) {
    const installData = installed[tpl.name]
    if (!installData) return
    setInstalling(tpl.name + '__fix')
    try {
      // Can't insert into apps (platform-managed, RLS blocks user inserts).
      // Instead, add named placeholder steps (app_id: null) so the workflow is complete.
      const { data: currentFlow } = await supabase.from('flows').select('steps').eq('id', installData.flowId).single()
      const existingSteps = currentFlow?.steps || []

      const installedByName = {}
      for (const s of existingSteps) installedByName[s.app_name.toLowerCase()] = s
      for (const appName of installData.missingNames) {
        installedByName[appName.toLowerCase()] = { app_name: appName, app_emoji: '⚡', app_id: null }
      }

      const fullSteps = tpl.appNames.map(name => {
        const lower = name.toLowerCase()
        return installedByName[lower]
          || Object.values(installedByName).find(s => s.app_name.toLowerCase().includes(lower) || lower.includes(s.app_name.toLowerCase()))
      }).filter(Boolean)

      const { error: updateErr } = await supabase.from('flows').update({ steps: fullSteps }).eq('id', installData.flowId)
      if (updateErr) throw updateErr

      setInstalled(p => ({
        ...p,
        [tpl.name]: { flowId: installData.flowId, stepCount: fullSteps.length, missingNames: [] },
      }))
      toast(`✓ All ${fullSteps.length} steps installed for "${tpl.name}"`, 'success', 4000)
    } catch (e) {
      toast(e.message || 'Failed to install missing apps', 'error')
    } finally {
      setInstalling(null)
    }
  }

  async function install(tpl) {
    setInstalling(tpl.name)
    try {
      const resolved = tpl.appNames.map(name => {
        const lower = name.toLowerCase()
        const match = apps.find(a => a.name.toLowerCase() === lower)
          || apps.find(a => a.name.toLowerCase().includes(lower) || lower.includes(a.name.toLowerCase()))
        return { name, match }
      })

      const steps = resolved.filter(r => r.match).map(r => ({
        app_id: r.match.id, app_name: r.match.name, app_emoji: r.match.emoji,
      }))
      const missingNames = resolved.filter(r => !r.match).map(r => r.name)

      if (steps.length === 0) {
        const list = missingNames.join(', ')
        toast(`Apps not found: ${list}. Add them to your library first.`, 'error', 6000)
        return
      }

      const { data, error } = await supabase.from('flows').insert({
        user_id: userId, name: tpl.name, emoji: tpl.emoji,
        description: tpl.desc, steps,
      }).select().single()

      if (error) throw error
      setInstalled(p => ({ ...p, [tpl.name]: { flowId: data.id, stepCount: steps.length, missingNames } }))
      onCreated(data)
      if (missingNames.length > 0) {
        toast(`"${tpl.name}" installed with ${steps.length} of ${tpl.appNames.length} steps. Missing: ${missingNames.join(', ')}`, 'warn', 6000)
      } else {
        toast(`"${tpl.name}" installed — ${steps.length} steps ready`, 'success', 4000)
      }
    } catch (e) {
      toast(e.message || 'Install failed', 'error')
    } finally {
      setInstalling(null)
    }
  }

  function handleTest(tpl) {
    const installData = installed[tpl.name]
    if (!installData) return
    const flow = flows.find(f => f.id === installData.flowId)
    if (!flow) return
    setTestError(p => { const n = { ...p }; delete n[tpl.name]; return n })
    onRunFlow?.(flow, success => {
      if (success) {
        setTested(prev => new Set([...prev, tpl.name]))
      } else {
        setTestError(p => ({ ...p, [tpl.name]: true }))
      }
    })
  }

  const packTemplates = QUICK_START_TEMPLATES.filter(t => t.pack === activePack)

  return (
    <div className="mb-6">
      <p className="text-xs text-slate-300 uppercase font-semibold tracking-wide mb-3">Quick start — install a workflow template</p>

      {/* Template cards for active pack */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {packTemplates.map(tpl => {
          const isInstalling = installing === tpl.name
          const installData = installed[tpl.name]
          const isDone = !!installData
          const hasPartial = isDone && installData.missingNames?.length > 0
          const isTested = tested.has(tpl.name)
          const hasTestError = testError[tpl.name]
          return (
            <div key={tpl.name}
              className={`flex flex-col text-left p-3 rounded-xl border transition-all ${isDone
                ? hasPartial ? 'border-amber-500/40 bg-amber-500/5' : 'border-green-500/40 bg-green-500/8'
                : 'border-white/20 bg-[#121829] hover:border-white/35 hover:bg-[#172035] hover:shadow-md hover:shadow-black/30'}`}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                  style={{ background: isDone ? (hasPartial ? '#f59e0b22' : '#10b98122') : tpl.color + '22' }}>
                  {isInstalling ? <span className="animate-spin text-sm">⟳</span> : isDone ? (hasPartial ? '⚠' : '✓') : tpl.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold leading-snug truncate">{tpl.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {isDone
                      ? `${installData.stepCount}/${tpl.appNames.length} steps`
                      : `${tpl.appNames.length} steps`}
                  </p>
                </div>
              </div>
              <p className="text-slate-400 text-[11px] leading-relaxed flex-1 line-clamp-2">{tpl.desc}</p>
              {isDone && hasPartial && (
                <div className="flex gap-1 flex-wrap mt-2">
                  {tpl.appNames.map(n => {
                    const isMissing = installData.missingNames?.includes(n)
                    return (
                      <span key={n} className={`text-[9px] border px-1.5 py-0.5 rounded-md ${isMissing
                        ? 'bg-red-400/8 border-red-400/25 text-red-400 line-through'
                        : 'bg-white/6 border-white/10 text-slate-400'}`}>{n}</span>
                    )
                  })}
                </div>
              )}
              {hasPartial && (
                <div className="mt-1 mb-1 space-y-1.5">
                  <p className="text-[9px] text-amber-400 leading-relaxed">
                    Missing: {installData.missingNames.join(', ')}
                  </p>
                  <button
                    onClick={() => !installing && installMissingApps(tpl)}
                    disabled={!!installing}
                    className="w-full text-[11px] font-semibold py-1.5 rounded-lg transition-all bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 disabled:opacity-50">
                    {installing === tpl.name + '__fix' ? '⟳ Installing…' : '⚡ Install missing'}
                  </button>
                </div>
              )}
              {isDone && !hasPartial ? (
                <div className="mt-2 space-y-1.5">
                  {isTested ? (
                    <div className="w-full text-[11px] py-1.5 rounded-lg text-center bg-green-500/10 text-green-400 border border-green-500/20">
                      ✓ Tested · {installData.stepCount} steps
                    </div>
                  ) : (
                    <>
                      <div className="workflow-action-button-muted w-full text-[11px] py-1.5 rounded-lg text-center">
                        ✓ Installed · {installData.stepCount} steps
                      </div>
                      {hasTestError && (
                        <p className="text-[10px] text-red-400 text-center">
                          ⚠ Test didn't complete
                        </p>
                      )}
                      <button
                        onClick={() => handleTest(tpl)}
                        className={`w-full text-[11px] font-semibold py-1.5 rounded-lg transition-all border ${hasTestError
                          ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/25'
                          : 'workflow-action-button'}`}>
                        {hasTestError ? '↺ Retry' : '▶ Test workflow'}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => !isDone && !installing && install(tpl)}
                  disabled={!!installing || isDone}
                  className={`mt-2 w-full text-[11px] font-medium py-1.5 rounded-lg transition-all disabled:opacity-50 ${isDone
                    ? 'cursor-default bg-white/5 text-slate-500'
                    : 'cursor-pointer workflow-action-button'}`}>
                  {isDone
                    ? `${installData.stepCount}/${tpl.appNames.length} steps`
                    : isInstalling ? 'Installing…' : '+ Install'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Goal Launcher ────────────────────────────────────────────────────────────
function GoalLauncher({ apps, flows, userId, onInstalled, onRunFlow }) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [installing, setInstalling] = useState(null)
  const toast = useToast()

  const suggestions = query.trim().length < 2 ? [] : (() => {
    const q = query.toLowerCase()
    return QUICK_START_TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.desc.toLowerCase().includes(q) ||
      t.appNames.some(a => a.toLowerCase().includes(q)) ||
      t.pack.toLowerCase().includes(q)
    ).slice(0, 5)
  })()

  async function installGoal(tpl) {
    const already = flows.find(f => f.name === tpl.name)
    if (already) { onRunFlow?.(already); setQuery(''); setFocused(false); return }
    setInstalling(tpl.name)
    try {
      const steps = tpl.appNames.map(name => {
        const lower = name.toLowerCase()
        const match = apps.find(a => a.name.toLowerCase() === lower)
          || apps.find(a => a.name.toLowerCase().includes(lower) || lower.includes(a.name.toLowerCase()))
        return match ? { app_id: match.id, app_name: match.name, app_emoji: match.emoji } : null
      }).filter(Boolean)
      const { data, error } = await supabase.from('flows').insert({
        user_id: userId, name: tpl.name, emoji: tpl.emoji, description: tpl.desc, steps,
      }).select().single()
      if (error) throw error
      onInstalled(data)
      toast(`"${tpl.name}" ready — ${steps.length} steps`, 'success')
      setQuery(''); setFocused(false)
    } catch (e) { toast(e.message || 'Install failed', 'error') }
    finally { setInstalling(null) }
  }

  return (
    <div className="mb-4 relative">
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-base">🎯</span>
        <input
          className="w-full bg-[#1A2038] border border-white/20 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors"
          placeholder="What do you want to automate today? e.g. follow-up emails, screen resumes, write proposals…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
        {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-lg leading-none">✕</button>}
      </div>
      {focused && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#121829] border border-white/20 rounded-xl overflow-hidden z-30 shadow-2xl">
          {suggestions.map(tpl => {
            const color = PACK_COLORS[tpl.pack]
            const isInstalling = installing === tpl.name
            const alreadyInstalled = !!flows.find(f => f.name === tpl.name)
            return (
              <div key={tpl.name} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 border-b border-white/8 last:border-0 transition-colors">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                  style={{ background: color + '22' }}>{tpl.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold">{tpl.name}
                    <span className="ml-1.5 text-[10px] font-normal px-1.5 py-0.5 rounded" style={{ background: color + '22', color }}>
                      {tpl.pack}
                    </span>
                  </p>
                  <p className="text-slate-400 text-[11px] truncate">{tpl.appNames.join(' → ')}</p>
                </div>
                <button
                  onClick={() => installGoal(tpl)}
                  disabled={isInstalling}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all disabled:opacity-50"
                  style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
                  {isInstalling ? '⟳' : alreadyInstalled ? '▶ Run' : '+ Use this'}
                </button>
              </div>
            )
          })}
        </div>
      )}
      {focused && query.trim().length >= 2 && suggestions.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#121829] border border-white/20 rounded-xl px-4 py-3 z-30 shadow-xl">
          <p className="text-slate-400 text-xs">No matching templates — <button className="text-[#6C5CE7] hover:underline" onClick={() => { setQuery(''); setFocused(false) }}>build a custom workflow</button></p>
        </div>
      )}
    </div>
  )
}

function WorkflowSuggestionsPanel({ flows, flowLastRuns, schedules, onRun, onCreate, onShowHistory }) {
  const recommendedFlow = (() => {
    const neverRun = flows.find(flow => !flowLastRuns[flow.id])
    if (neverRun) {
      return {
        flow: neverRun,
        reason: 'Ready for a first full test',
        detail: 'Run this once so users can trust it before depending on it.'
      }
    }

    const stale = flows.find(flow => {
      const lastRun = flowLastRuns[flow.id]
      if (!lastRun) return false
      return Date.now() - new Date(lastRun.created_at).getTime() > 14 * 24 * 60 * 60 * 1000
    })
    if (stale) {
      return {
        flow: stale,
        reason: 'Due for a fresh run',
        detail: 'It has been more than two weeks since this workflow was tested.'
      }
    }

    const manualOnly = flows.find(flow => !schedules[flow.id])
    if (manualOnly) {
      return {
        flow: manualOnly,
        reason: 'Candidate for automation',
        detail: 'Add a schedule once the workflow output is consistently useful.'
      }
    }

    return flows[0] ? {
      flow: flows[0],
      reason: 'Keep the system warm',
      detail: 'Run a proven workflow and check the latest output quality.'
    } : null
  })()

  if (!recommendedFlow) return null

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-[#12182A] p-4 shadow-[0_14px_40px_rgba(0,0,0,0.18)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-semibold text-[#A29BFE]">AI recommended next action</div>
          <h3 className="mt-1 text-white font-semibold text-lg">{recommendedFlow.flow.name}</h3>
          <p className="mt-1 text-sm text-slate-300">
            <span className="text-white">{recommendedFlow.reason}.</span> {recommendedFlow.detail}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onRun(recommendedFlow.flow)}
            className="px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#5a4bd1] text-white text-sm font-semibold transition-all"
          >
            Run suggested workflow
          </button>
          <button
            onClick={onCreate}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white text-sm font-semibold transition-all"
          >
            Design new workflow
          </button>
          <button
            onClick={onShowHistory}
            className="px-4 py-2 rounded-lg bg-transparent hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-semibold transition-all"
          >
            Review history
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Flows Page ───────────────────────────────────────────────────────────────
export default function FlowsPage({ user, onShowHistory }) {
  const [flows, setFlows] = useState([])
  const [apps, setApps] = useState([])
  const [domains, setDomains] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState(null)
  const [editingFlow, setEditingFlow] = useState(null)
  const [runningFlow, setRunningFlow] = useState(null)
  const [runningFlowCallback, setRunningFlowCallback] = useState(null)
  const [deletedFlowId, setDeletedFlowId] = useState(null)
  const [tab, setTab] = useState('mine')
  const [flowSearch, setFlowSearch] = useState('')
  const [flowViewMode, setFlowViewMode] = useState(() => localStorage.getItem('aistrix:flowViewMode') || 'cards')
  const [activePack, setActivePack] = useState('General')
  const [publicFlows, setPublicFlows] = useState([])
  const [loadingPublic, setLoadingPublic] = useState(false)
  const [sharedFlows, setSharedFlows] = useState([])
  const [sharedRoles, setSharedRoles] = useState({})
  const [loadingShared, setLoadingShared] = useState(false)
  const [sharingFlow, setSharingFlow] = useState(null)
  const [schedulingFlow, setSchedulingFlow] = useState(null)
  const [webhookFlow, setWebhookFlow] = useState(null)
  const [schedules, setSchedules] = useState({})
  const [prefillStep, setPrefillStep] = useState(null) // { app_id, app_name, app_emoji } | null
  const toast = useToast()

  useEffect(() => {
    const handler = () => { setMode('create'); setEditingFlow(null); setPrefillStep(null) }
    window.addEventListener('aistrix:new-workflow', handler)
    return () => window.removeEventListener('aistrix:new-workflow', handler)
  }, [])

  // "Turn into workflow" next-best-action from an app run — opens the builder
  // with that app pre-added as step 1, so the user isn't starting from scratch.
  useEffect(() => {
    const handler = e => {
      const app = e.detail
      setMode('create'); setEditingFlow(null)
      setPrefillStep(app ? { app_id: app.id, app_name: app.name, app_emoji: app.emoji } : null)
    }
    window.addEventListener('aistrix:workflow-from-app', handler)
    return () => window.removeEventListener('aistrix:workflow-from-app', handler)
  }, [])

  useEffect(() => {
    supabase.from('flow_schedules').select('*').eq('user_id', user.id)
      .then(({ data }) => setSchedules(Object.fromEntries((data || []).map(s => [s.flow_id, s]))))
  }, [user.id])

  const [flowLastRuns, setFlowLastRuns] = useState({}) // flow_id → { created_at, app_name }

  useEffect(() => {
    Promise.all([
      supabase.from('flows').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('apps').select('id, name, emoji, color, domain_id, domains(id, name, emoji)').order('name'),
      supabase.from('domains').select('id, name, emoji, color').order('name'),
    ]).then(async ([{ data: f }, { data: a }, { data: d }]) => {
      setFlows(f ?? []); setApps(a ?? []); setDomains(d ?? []); setLoading(false)
      // Fetch the most recent run for each flow to show "last run" metadata on cards
      if (f?.length) {
        const flowIds = f.map(fl => fl.id)
        const { data: runs } = await supabase.from('run_history')
          .select('flow_id, created_at, app_name')
          .eq('user_id', user.id)
          .in('flow_id', flowIds)
          .order('created_at', { ascending: false })
        if (runs) {
          const map = {}
          for (const r of runs) {
            if (!map[r.flow_id]) map[r.flow_id] = r
          }
          setFlowLastRuns(map)
        }
      }
    })
  }, [user.id])

  async function loadShared() {
    setLoadingShared(true)
    const { data: memberships } = await supabase.from('flow_members').select('flow_id, role')
      .or(`user_id.eq.${user.id},invited_email.eq.${user.email}`)
    const ids = [...new Set((memberships || []).map(m => m.flow_id))]
    const roles = {}
    for (const m of memberships || []) roles[m.flow_id] = m.role
    setSharedRoles(roles)
    if (!ids.length) { setSharedFlows([]); setLoadingShared(false); return }
    const { data } = await supabase.from('flows').select('*').in('id', ids)
    setSharedFlows(data || [])
    setLoadingShared(false)
  }

  async function saveFlow(data) {
    if (editingFlow) {
      const { data: row, error } = await supabase.from('flows').update(data).eq('id', editingFlow.id).select().single()
      if (error) { toast(error.message, 'error'); return }
      setFlows(p => p.map(f => f.id === editingFlow.id ? row : f))
      setSharedFlows(p => p.map(f => f.id === editingFlow.id ? row : f))
      toast('Workflow updated', 'success')
    } else {
      const { data: row, error } = await supabase.from('flows').insert({ ...data, user_id: user.id }).select().single()
      if (error) { toast(error.message, 'error'); return }
      setFlows(p => [row, ...p])
      toast('Workflow created', 'success')
    }
    setMode(null); setEditingFlow(null); setPrefillStep(null)
  }

  async function deleteFlow(id) {
    if (!confirm('Delete this workflow?')) return
    const { error } = await supabase.from('flows').delete().eq('id', id)
    if (error) { toast(`Couldn't delete workflow: ${error.message}`, 'error'); return }
    setFlows(p => p.filter(f => f.id !== id))
    setDeletedFlowId(id)
    toast('Workflow deleted', 'info', 2000)
  }

  async function loadMarketplace() {
    setLoadingPublic(true)
    const { data } = await supabase.from('flows').select('*').eq('is_published', true).order('install_count', { ascending: false }).limit(20)
    setPublicFlows(data || []); setLoadingPublic(false)
  }

  async function installWorkspace(flow) {
    const { error } = await supabase.from('flows').insert({
      user_id: user.id, name: flow.name, emoji: flow.emoji, description: flow.description, steps: flow.steps,
    })
    if (error) { toast(`Couldn't install "${flow.name}": ${error.message}`, 'error'); return }
    await supabase.from('flows').update({ install_count: (flow.install_count || 0) + 1 }).eq('id', flow.id)
    toast(`"${flow.name}" installed`, 'success')
    const { data } = await supabase.from('flows').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    if (data) setFlows(data)
    setTab('mine')
  }

  async function publishWorkspace(flow) {
    const { error } = await supabase.from('flows').update({ is_published: !flow.is_published }).eq('id', flow.id)
    if (error) { toast(error.message, 'error'); return }
    setFlows(p => p.map(f => f.id === flow.id ? { ...f, is_published: !f.is_published } : f))
    toast(flow.is_published ? 'Unpublished' : 'Published to marketplace', 'success')
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {runningFlow && <FlowRunner
        flow={runningFlow}
        user={user}
        onClose={() => {
          // Only signal failure if the run never completed successfully
          runningFlowCallback?.(false)
          setRunningFlow(null)
          setRunningFlowCallback(null)
        }}
        onShowHistory={onShowHistory}
        onRunComplete={success => {
          if (success) {
            // Fire callback immediately; clear it so onClose won't fire false afterward
            runningFlowCallback?.(true)
            setRunningFlowCallback(null)
            // Runner stays open so user sees the completion screen — closed by Done button
          }
        }}
      />}
      {sharingFlow && <ShareModal flow={sharingFlow} onClose={() => setSharingFlow(null)} />}
      {schedulingFlow && (
        <ScheduleModal flow={schedulingFlow} userId={user.id} onClose={() => setSchedulingFlow(null)}
          onSaved={row => setSchedules(p => {
            const next = { ...p }
            if (row) next[schedulingFlow.id] = row
            else delete next[schedulingFlow.id]
            return next
          })} />
      )}
      {webhookFlow && (
        <WebhookModal flow={webhookFlow} onClose={() => setWebhookFlow(null)}
          onUpdated={updated => {
            setFlows(prev => prev.map(f => f.id === updated.id ? updated : f))
            setWebhookFlow(updated)
          }} />
      )}
      {mode && (
        <FlowBuilderModal
          apps={apps}
          domains={domains}
          existingFlow={editingFlow}
          initialSteps={prefillStep ? [prefillStep] : undefined}
          onSave={saveFlow}
          onCancel={() => { setMode(null); setEditingFlow(null); setPrefillStep(null) }}
        />
      )}

      {/* ── Fixed top area ── */}
      <div className="shrink-0 px-6 pt-6 relative z-10 bg-[var(--app-bg)]">
        {/* Row 1: Tabs + action button */}
        <div className="section-tab-row flex items-center justify-between">
          <div className="section-tabs">
            <button onClick={() => setTab('mine')}
              className={`section-tab ${tab === 'mine' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">My Workflows</span>
              {flows.length > 0 && <span className="section-tab-count">{flows.length}</span>}
              🗂 My Workflows {flows.length > 0 && <span className="ml-1.5 opacity-70">{flows.length}</span>}
            </button>
            <button onClick={() => { setTab('shared'); loadShared() }}
              className={`section-tab ${tab === 'shared' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">Shared</span>
              {sharedFlows.length > 0 && <span className="section-tab-count">{sharedFlows.length}</span>}
              👥 Shared {sharedFlows.length > 0 && <span className="ml-1.5 opacity-70">{sharedFlows.length}</span>}
            </button>
            <button onClick={() => { setTab('marketplace'); loadMarketplace() }}
              className={`section-tab ${tab === 'marketplace' ? 'section-tab-active' : ''}`}>
              <span className="section-tab-label">Marketplace</span>
              🌐 Marketplace
            </button>
          </div>
        </div>

        {/* Row 2: Goal Launcher + Quick-start templates */}
        {tab === 'mine' && (
          <GoalLauncher
            apps={apps}
            flows={flows}
            userId={user.id}
            onInstalled={row => setFlows(p => [row, ...p])}
            onRunFlow={flow => setRunningFlow(flow)}
          />
        )}
        {tab === 'mine' && (
          <QuickStartTemplates
            apps={apps}
            flows={flows}
            userId={user.id}
            onCreated={row => setFlows(p => [row, ...p])}
            deletedFlowId={deletedFlowId}
            onRunFlow={(flow, cb) => { setRunningFlow(flow); setRunningFlowCallback(() => cb) }}
            activePack={activePack}
          />
        )}
        {tab === 'mine' && !loading && flows.length > 0 && (
          <WorkflowSuggestionsPanel
            flows={flows}
            flowLastRuns={flowLastRuns}
            schedules={schedules}
            onRun={flow => setRunningFlow(flow)}
            onCreate={() => { setMode('create'); setEditingFlow(null) }}
            onShowHistory={onShowHistory}
          />
        )}

        {/* Row 3: My Workflows heading + pack tabs + search + view toggle */}
        {tab === 'mine' && !loading && flows.length > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <h2 className="text-white font-semibold text-base shrink-0">My Workflows</h2>
            <div className="flex gap-1.5 flex-wrap">
              {TEMPLATE_PACKS.map(pack => {
                return (
                  <button key={pack}
                    onClick={() => setActivePack(pack)}
                    className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg text-xs font-medium transition-all ${activePack === pack
                      ? 'text-white border'
                      : 'bg-[#1A2038] text-slate-400 hover:text-white border border-white/10'}`}
                    style={activePack === pack ? { background: PACK_COLORS[pack] + '33', borderColor: PACK_COLORS[pack] + '66' } : {}}>
                    <span>{PACK_ICONS[pack]}</span>
                    <span>{pack}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex-1" />
            <div className="relative shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
              <input
                value={flowSearch}
                onChange={e => setFlowSearch(e.target.value)}
                placeholder="Search workflows..."
                className="w-40 bg-[#1A2038] border border-white/20 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#6C5CE7] transition-colors"
              />
            </div>
            <div className="flex items-center bg-[#1A2038] border border-white/20 rounded-lg p-0.5 shrink-0">
              <button onClick={() => { setFlowViewMode('compact'); localStorage.setItem('aistrix:flowViewMode', 'compact') }}
                title="Compact tiles" aria-label="Compact tiles view"
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${flowViewMode === 'compact' ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
                <span aria-hidden="true">▦</span>
              </button>
              <button onClick={() => { setFlowViewMode('cards'); localStorage.setItem('aistrix:flowViewMode', 'cards') }}
                title="Detailed cards" aria-label="Detailed cards view"
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${flowViewMode === 'cards' ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
                <span aria-hidden="true">▤</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Floating scrollable area ── */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">

        {/* My Workflows */}
        {tab === 'mine' && (
          loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-slate-400 text-sm">Loading workflows...</p>
            </div>
          ) : flows.length === 0 ? (
            <div className="relative border border-dashed border-white/18 rounded-2xl p-10 text-center overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[#6C5CE7]/5 via-transparent to-[#E84393]/5 pointer-events-none" />
              <div className="relative">
                <p className="text-white font-semibold mb-1">No workflows yet</p>
                <p className="text-slate-400 text-sm mb-4">Install a template to get started in seconds.</p>
                <button onClick={() => { setMode('create'); setEditingFlow(null) }}
                  className="text-xs text-slate-400 hover:text-slate-300 transition-colors underline underline-offset-2">
                  or build one from scratch
                </button>
              </div>
            </div>
          ) : flowViewMode === 'compact' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {flows.filter(f => !flowSearch || f.name.toLowerCase().includes(flowSearch.toLowerCase()) || f.description?.toLowerCase().includes(flowSearch.toLowerCase())).map(flow => (
                <WorkflowTab
                  key={flow.id}
                  flow={flow}
                  userId={user.id}
                  lastRun={flowLastRuns[flow.id] || null}
                  onRun={() => setRunningFlow(flow)}
                  onEdit={() => { setEditingFlow(flow); setMode('edit') }}
                  onDelete={() => deleteFlow(flow.id)}
                  schedule={schedules[flow.id]}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {(() => {
                const neverRun = Object.keys(flowLastRuns).length === 0
                const filtered = flows.filter(f => !flowSearch || f.name.toLowerCase().includes(flowSearch.toLowerCase()) || f.description?.toLowerCase().includes(flowSearch.toLowerCase()))
                return filtered.map((flow, idx) => (
                  <WorkspaceCard
                    key={flow.id}
                    flow={flow}
                    userId={user.id}
                    lastRun={flowLastRuns[flow.id] || null}
                    suggestStart={neverRun && idx === 0}
                    onRun={() => setRunningFlow(flow)}
                    onEdit={() => { setEditingFlow(flow); setMode('edit') }}
                    onDelete={() => deleteFlow(flow.id)}
                    onPublish={() => publishWorkspace(flow)}
                    onShare={() => setSharingFlow(flow)}
                    onSchedule={() => setSchedulingFlow(flow)}
                    onWebhook={() => setWebhookFlow(flow)}
                    schedule={schedules[flow.id]}
                  />
                ))
              })()}
            </div>
          )
        )}

        {/* Shared with me */}
        {tab === 'shared' && (
          loadingShared ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-slate-400 text-sm">Loading shared workflows...</p>
            </div>
          ) : sharedFlows.length === 0 ? (
            <div className="border border-dashed border-white/18 rounded-2xl p-12 text-center">
              <div className="text-4xl mb-3">👥</div>
              <p className="text-white font-medium mb-1">No workflows shared with you yet</p>
              <p className="text-slate-400 text-sm">Ask a teammate to invite you via the 👥 icon on one of their workflows.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {sharedFlows.filter(f => !flowSearch || f.name.toLowerCase().includes(flowSearch.toLowerCase())).map(flow => (
                <WorkspaceCard
                  key={flow.id}
                  flow={flow}
                  userId={user.id}
                  role={sharedRoles[flow.id]}
                  onRun={() => setRunningFlow(flow)}
                  onEdit={() => { setEditingFlow(flow); setMode('edit') }}
                />
              ))}
            </div>
          )
        )}

        {/* Marketplace */}
        {tab === 'marketplace' && (
          loadingPublic ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-slate-400 text-sm">Loading...</p>
            </div>
          ) : publicFlows.length === 0 ? (
            <div className="border border-dashed border-white/18 rounded-2xl p-12 text-center">
              <div className="text-4xl mb-3">🌐</div>
              <p className="text-white font-medium mb-1">No public workflows yet</p>
              <p className="text-slate-400 text-sm">Create a workflow and publish it to share with others.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {publicFlows.filter(f => !flowSearch || f.name.toLowerCase().includes(flowSearch.toLowerCase())).map(flow => (
                <div key={flow.id} className="relative bg-[#121829] border border-white/18 hover:border-white/18 rounded-2xl overflow-hidden p-5 transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                      style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.25), rgba(232,67,147,0.18))' }}>{flow.emoji}</div>
                    <div>
                      <p className="text-white font-semibold text-sm">{flow.name}</p>
                      <p className="text-[11px] text-slate-300">{flow.steps?.length || 0} steps · ⬇ {flow.install_count || 0} installs</p>
                    </div>
                  </div>
                  {flow.description && <p className="text-xs text-slate-400 mb-3 leading-relaxed">{flow.description}</p>}
                  <div className="flex gap-1 mb-4 flex-wrap">
                    {(flow.steps || []).map((s, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="text-[10px] bg-[#1A2038] text-slate-400 px-2 py-1 rounded-lg">{s.app_emoji} {s.app_name}</span>
                        {i < flow.steps.length - 1 && <span className="text-[#6C5CE7]/50 text-xs">→</span>}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => installWorkspace(flow)}
                    className="w-full bg-gradient-to-r from-[#6C5CE7] to-[#8B7CF6] hover:from-[#7D6FF0] hover:to-[#9C8FFF] text-white text-sm py-2.5 rounded-xl font-semibold transition-all shadow-md shadow-[#6C5CE7]/20">
                    ↓ Install workflow
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
