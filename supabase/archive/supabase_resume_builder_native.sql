-- Convert Resume Builder from a single-textarea prompt app into a structured
-- Native App with typed form fields. Run in the Supabase SQL editor.
-- Scoped to the seeded developer account so it won't touch any other user's copy.

UPDATE apps
SET
  app_type = 'native',
  emoji    = '📄',
  description = 'Build a tailored resume for any role. Fill in your experience, target role, and tone — AI generates a polished, ATS-ready resume section.',

  form_schema = '[
    {
      "id": "target_role",
      "type": "text",
      "label": "Target Role",
      "placeholder": "e.g. Senior Product Manager at a fintech startup",
      "required": true
    },
    {
      "id": "job_description",
      "type": "textarea",
      "label": "Job Description",
      "placeholder": "Paste the job posting here. The AI will tailor your resume to match its language and requirements.",
      "required": false
    },
    {
      "id": "work_experience",
      "type": "textarea",
      "label": "Work Experience",
      "placeholder": "List your relevant roles and accomplishments, e.g.:\nProduct Manager @ Acme (2021–2024) — Launched checkout redesign, +18% conversion\nSoftware Engineer @ Beta (2019–2021) — Built payment pipeline processing $2M/day",
      "required": true
    },
    {
      "id": "skills",
      "type": "textarea",
      "label": "Key Skills",
      "placeholder": "e.g. Python, SQL, A/B testing, stakeholder management, Figma, Agile",
      "required": false
    },
    {
      "id": "tone",
      "type": "select",
      "label": "Tone",
      "options": "Professional, Confident & Direct, Creative, Conservative",
      "required": false
    },
    {
      "id": "output_section",
      "type": "select",
      "label": "What to Generate",
      "options": "Full Resume, Professional Summary Only, Work Experience Section, Skills Section, Cover Letter Intro",
      "required": false
    }
  ]'::jsonb,

  system_prompt = 'You are an expert resume writer and career coach. The user will provide structured information via a form. Use it to generate polished, ATS-optimised resume content.

Guidelines:
- Mirror language from the job description wherever provided — recruiters and ATS systems scan for keyword matches.
- Lead with impact: start every bullet with a strong action verb, follow with a measurable result where possible (%, $, time saved, team size).
- Adjust vocabulary and style to match the requested tone.
- For "Full Resume", include: Professional Summary, Work Experience, Skills, and (if inferable) an Education placeholder.
- For section-only requests, focus entirely on that section.
- Do not fabricate facts — work only with what the user has supplied. If a detail is missing, note it as [Add here].
- Output clean Markdown ready to paste into a document.

Form fields provided by the user:
{{Target Role}} — the role being applied for
{{Job Description}} — the posting to optimise against (may be empty)
{{Work Experience}} — existing roles and achievements
{{Key Skills}} — technical and soft skills
{{Tone}} — writing style preference
{{What to Generate}} — which section(s) to produce',

  output_type = 'markdown',
  tags = ARRAY['career', 'job_search', 'resume', 'writing']

WHERE name = 'Resume Builder'
  AND created_by = (
    SELECT id FROM auth.users WHERE email = 'manhome2020@gmail.com'
  );
