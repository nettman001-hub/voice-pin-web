import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured')
}

export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('VOICECAP_WEB_ORIGIN') ?? 'https://www.voicecap.shop',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-voicecap-device-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders })

export const handleCors = (request: Request) =>
  request.method === 'OPTIONS'
    ? new Response('ok', { headers: corsHeaders })
    : null

export const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash)).map((part) => part.toString(16).padStart(2, '0')).join('')
}

export const randomSecret = (byteLength = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return Array.from(bytes).map((part) => part.toString(16).padStart(2, '0')).join('')
}

export async function authenticatedUser(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !anonKey) return null
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data, error } = await client.auth.getUser()
  return error ? null : data.user
}

export async function activeDevice(request: Request) {
  const token = request.headers.get('x-voicecap-device-token')?.trim()
  if (!token) return null
  const { data, error } = await admin
    .from('devices')
    .select('id, workspace_id, name')
    .eq('token_hash', await sha256(token))
    .is('revoked_at', null)
    .maybeSingle()
  if (error || !data) return null
  await admin.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)
  return data
}

export async function workspaceMembership(userId: string, workspaceId?: string) {
  let query = admin
    .from('workspace_members')
    .select('workspace_id, role, workspaces(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (workspaceId) query = query.eq('workspace_id', workspaceId)
  const { data, error } = await query.maybeSingle()
  if (error || !data) return null
  return data
}

export const validMessageStatus = new Set(['RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'FAILED'])
export const validMessageCategory = new Set(['PURCHASE_INFO', 'CUSTOMER_INQUIRY', 'QUESTION', 'ANSWER', 'INVOICE', 'SHIPPING', 'GENERAL'])

export function base64Bytes(dataUrl: string) {
  const matched = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!matched) throw new Error('지원하지 않는 이미지 형식입니다.')
  const encoded = matched[2].replace(/\s/g, '')
  const raw = atob(encoded)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('이미지는 4MB 이하만 지원합니다.')
  return { mimeType: matched[1].toLowerCase(), bytes }
}
