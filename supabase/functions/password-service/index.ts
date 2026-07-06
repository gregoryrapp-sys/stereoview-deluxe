import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import * as bcrypt from 'https://deno.land/x/bcrypt/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'

console.log(`Function "password-service" up and running!`)

serve(async (req) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, password, hash } = await req.json()

    if (type === 'hash') {
      if (!password || typeof password !== 'string') {
        throw new Error('A non-empty "password" string is required for hashing.')
      }
      const hashedPassword = await bcrypt.hash(password)
      return new Response(JSON.stringify({ hash: hashedPassword }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (type === 'verify') {
      if (!password || !hash || typeof password !== 'string' || typeof hash !== 'string') {
        throw new Error('Both "password" and "hash" strings are required for verification.')
      }
      const valid = await bcrypt.compare(password, hash)
      return new Response(JSON.stringify({ valid }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    throw new Error('Invalid "type" specified. Use "hash" or "verify".')
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})