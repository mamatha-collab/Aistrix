// Pure helpers for turning a career/business profile row into plain-text
// context injected into AI runs. Pulled out of pages/ProfilesPage.jsx: that
// file is lazy-loaded (`lazy(() => import('./pages/ProfilesPage'))` in
// App.jsx) so it ships as its own chunk, but AppRunner.jsx — which is in the
// main bundle — statically imported these two functions from it. That static
// import forced Rollup/Vite to pull the entire ProfilesPage module (and
// everything it imports) back into the main chunk, silently defeating the
// code-split (Vite even warns about this: "is dynamically imported... but
// also statically imported", "dynamic import will not move module into
// another chunk"). Since these two functions have no dependency on the page
// component itself, moving them here lets ProfilesPage.jsx split out cleanly.

export function buildCareerContext(p) {
  if (!p) return ''
  const lines = []
  if (p.full_name)           lines.push(`Name: ${p.full_name}`)
  if (p.job_title)        lines.push(`Current Role: ${p.job_title}`)
  if (p.experience_years)    lines.push(`Experience: ${p.experience_years}`)
  if (p.skills)              lines.push(`Skills: ${p.skills}`)
  if (p.education)           lines.push(`Education: ${p.education}`)
  if (p.location)            lines.push(`Location: ${p.location}`)
  if (p.preferred_locations) lines.push(`Preferred Locations: ${p.preferred_locations}`)
  if (p.salary_range)        lines.push(`Salary Range: ${p.salary_range}`)
  if (p.linkedin_url)        lines.push(`LinkedIn: ${p.linkedin_url}`)
  if (p.bio)                 lines.push(`\nBio:\n${p.bio}`)
  if (p.resume_text)         lines.push(`\nResume:\n${p.resume_text}`)
  return lines.join('\n')
}

export function buildBusinessContext(p) {
  if (!p) return ''
  const lines = []
  if (p.company_name)        lines.push(`Company: ${p.company_name}`)
  if (p.website)             lines.push(`Website: ${p.website}`)
  if (p.industry)            lines.push(`Industry: ${p.industry}`)
  if (p.products)            lines.push(`Products/Services: ${p.products}`)
  if (p.brand_voice)         lines.push(`Brand Voice: ${p.brand_voice}`)
  if (p.target_audience)     lines.push(`Target Audience: ${p.target_audience}`)
  if (p.brand_colors)        lines.push(`Brand Colors: ${p.brand_colors}`)
  if (p.contact_info)        lines.push(`Contact: ${p.contact_info}`)
  if (p.company_description) lines.push(`\nAbout:\n${p.company_description}`)
  return lines.join('\n')
}
