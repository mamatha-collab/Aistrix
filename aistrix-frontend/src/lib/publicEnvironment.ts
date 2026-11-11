// Public values only. Never add service-role or provider secrets here.
export function requiredPublicValue(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: string | undefined): string {
  if (!value) throw new Error(`${name} is required. Configure the selected frontend environment.`)
  return value
}
