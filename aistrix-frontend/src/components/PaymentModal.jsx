import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
// useToast is used in CheckoutForm below and in PaymentModal

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Lazy-load Stripe only when needed
let stripePromise = null
function getStripe() {
  const key = import.meta.env.VITE_STRIPE_PUBLIC_KEY
  if (!key) return null
  if (!stripePromise) stripePromise = loadStripe(key)
  return stripePromise
}

const CARD_STYLE = {
  style: {
    base: {
      color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
      '::placeholder': { color: '#64748b' },
      backgroundColor: 'transparent',
    },
    invalid: { color: '#f87171' },
  },
}

function CheckoutForm({ app, user, onSuccess, onClose }) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()

  async function handlePay(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setProcessing(true); setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()

      // Create payment intent on backend
      const res = await fetch(`${API_URL}/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ app_id: app.id, amount: Math.round(app.price_per_run * 100), currency: 'usd' }),
      })
      const { client_secret, error: backendError } = await res.json()
      if (backendError) throw new Error(backendError)

      // Confirm payment
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(client_secret, {
        payment_method: { card: elements.getElement(CardElement) },
      })

      if (stripeError) throw new Error(stripeError.message)

      if (paymentIntent.status === 'succeeded') {
        // Record payment
        await supabase.from('app_payments').insert({
          app_id: app.id, user_id: user.id,
          amount: app.price_per_run, currency: 'usd', status: 'completed',
          stripe_payment_intent_id: paymentIntent.id,
        })
        // Upsert entitlement for this pay-per-run purchase
        await supabase.from('app_entitlements').upsert({
          app_id: app.id, user_id: user.id,
          plan: 'pay_per_run', status: 'active',
          runs_this_period: 0, run_quota: null,
        }, { onConflict: 'app_id,user_id', ignoreDuplicates: false })
        toast(`Payment successful — running ${app.name}`, 'success')
        onSuccess()
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <div className="bg-[#1F2444] border border-white/10 rounded-xl p-4">
        <CardElement options={CARD_STYLE} />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">{error}</div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onClose}
          className="flex-1 bg-[#1F2444] hover:bg-[#272C52] text-slate-300 py-2.5 rounded-xl text-sm transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={!stripe || processing}
          className="flex-1 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors">
          {processing ? 'Processing...' : `Pay $${app.price_per_run}`}
        </button>
      </div>

      <p className="text-[10px] text-slate-600 text-center flex items-center justify-center gap-1">
        🔒 Secured by Stripe · Your card info never touches our servers
      </p>
    </form>
  )
}

async function startCheckoutSession(app, user, plan) {
  const { data: { session } } = await supabase.auth.getSession()
  const origin = window.location.origin
  const res = await fetch(`${API_URL}/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({
      app_id: app.id,
      plan,
      success_url: `${origin}/app/${app.id}?checkout=success`,
      cancel_url:  `${origin}/app/${app.id}?checkout=cancelled`,
    }),
  })
  const { checkout_url, error } = await res.json()
  if (error) throw new Error(error)
  window.location.href = checkout_url
}

export default function PaymentModal({ app, user, onSuccess, onClose }) {
  const stripe = getStripe()
  const hasStripe = !!import.meta.env.VITE_STRIPE_PUBLIC_KEY
  const [plan, setPlan] = useState('pay_per_run')   // pay_per_run | subscription
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const toast = useToast()

  async function handleCheckout() {
    setCheckoutLoading(true)
    setCheckoutError('')
    try {
      await startCheckoutSession(app, user, plan)
      // page will redirect — no further action needed
    } catch (e) {
      setCheckoutError(e.message)
      setCheckoutLoading(false)
    }
  }

  if (!hasStripe) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
        <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-sm p-6 text-center space-y-4">
          <div className="text-4xl">💳</div>
          <h3 className="text-white font-semibold">{app.name} — Paid App</h3>
          <p className="text-slate-400 text-sm">This app costs <strong className="text-white">${app.price_per_run}</strong> per run.</p>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <p className="text-amber-400 text-xs">Stripe is not configured. Add <code>VITE_STRIPE_PUBLIC_KEY</code> to enable payments.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-[#1F2444] text-slate-300 py-2.5 rounded-xl text-sm">Cancel</button>
            <button onClick={onSuccess} className="flex-1 bg-[#6C5CE7] text-white py-2.5 rounded-xl text-sm font-semibold">
              Run anyway (dev mode)
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{app.emoji}</span>
            <div>
              <p className="text-white font-semibold text-sm">{app.name}</p>
              <p className="text-slate-400 text-xs">${app.price_per_run} per run</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white text-lg">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Plan selector */}
          <div className="flex bg-[#0E1424] rounded-xl p-1 gap-1">
            <button onClick={() => setPlan('pay_per_run')}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${plan === 'pay_per_run' ? 'bg-[#6C5CE7] text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              Pay per run
            </button>
            <button onClick={() => setPlan('subscription')}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${plan === 'subscription' ? 'bg-[#6C5CE7] text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              Subscribe monthly
            </button>
          </div>

          {plan === 'pay_per_run' ? (
            <>
              <p className="text-slate-400 text-sm">
                You'll be charged <strong className="text-white">${app.price_per_run}</strong> for this run.
                You can also embed your card directly below.
              </p>

              {/* Tabs: Checkout redirect vs embedded card */}
              <div className="space-y-3">
                <button onClick={handleCheckout} disabled={checkoutLoading}
                  className="w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors">
                  {checkoutLoading ? 'Redirecting…' : 'Pay with Stripe Checkout →'}
                </button>
                <div className="relative flex items-center gap-2">
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-[10px] text-slate-600">or enter card directly</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>
                <Elements stripe={stripe}>
                  <CheckoutForm app={app} user={user} onSuccess={onSuccess} onClose={onClose} />
                </Elements>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-[#6C5CE7]/10 border border-[#6C5CE7]/20 rounded-xl p-4 space-y-1">
                <p className="text-white text-sm font-semibold">Monthly subscription</p>
                <p className="text-slate-400 text-xs">
                  <strong className="text-white">${app.price_per_run}/month</strong> — unlimited runs, cancel anytime.
                  Your entitlement is activated automatically after payment.
                </p>
              </div>
              {checkoutError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-xs">{checkoutError}</div>
              )}
              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 bg-[#1F2444] hover:bg-[#272C52] text-slate-300 py-2.5 rounded-xl text-sm transition-colors">
                  Cancel
                </button>
                <button onClick={handleCheckout} disabled={checkoutLoading}
                  className="flex-1 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors">
                  {checkoutLoading ? 'Redirecting…' : 'Subscribe →'}
                </button>
              </div>
            </div>
          )}

          {checkoutError && plan === 'pay_per_run' && (
            <p className="text-red-400 text-xs">{checkoutError}</p>
          )}
          <p className="text-[10px] text-slate-600 text-center">🔒 Secured by Stripe</p>
        </div>
      </div>
    </div>
  )
}
