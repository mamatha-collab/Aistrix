'use client'

export default function ApplicationError({ reset }) {
  return (
    <div role="alert" className="min-h-screen bg-[#09101F] text-white grid place-items-center">
      <div>
        <h1>Aistrix could not load this page.</h1>
        <button type="button" onClick={reset} className="underline mt-4">Try again</button>
      </div>
    </div>
  )
}
