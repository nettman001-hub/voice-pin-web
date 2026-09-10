import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('VOICECAP_WEB_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-voicecap-device-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

export function successResponse(data: unknown, status = 200) {
  return jsonResponse(
    {
      ok: true,
      apiVersion: 1,
      serverTime: new Date().toISOString(),
      data,
    },
    status
  )
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
  details: Record<string, unknown> = {},
  retryable = false
) {
  return jsonResponse(
    {
      ok: false,
      apiVersion: 1,
      serverTime: new Date().toISOString(),
      error: {
        code,
        message,
        retryable,
        details,
      },
    },
    status
  )
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface AuthContext {
  workspaceId: string
  actorId: string
  actorType: 'USER' | 'DEVICE'
  role?: string
  capabilities: Set<string>
  deviceId?: string
}

export async function authenticateRequest(request: Request, requestedWorkspaceId?: string): Promise<AuthContext | null> {
  const authHeader = request.headers.get('authorization') ?? ''
  const deviceToken = request.headers.get('x-voicecap-device-token')?.trim()

  // 1. Check Device Token
  if (deviceToken) {
    const tokenHash = await sha256(deviceToken)
    const { data: device, error } = await admin
      .from('devices')
      .select('id, workspace_id, name, capabilities, revoked_at')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle()

    if (error || !device) return null

    await admin.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', device.id)

    const capabilities = new Set<string>(device.capabilities || ['SMS'])
    return {
      workspaceId: device.workspace_id,
      actorId: device.id,
      actorType: 'DEVICE',
      deviceId: device.id,
      capabilities,
    }
  }

  // 2. Check Supabase User Bearer Token
  if (authHeader.startsWith('Bearer ') && anonKey) {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    })
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError || !authData?.user) return null

    const userId = authData.user.id
    let query = admin
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)

    if (requestedWorkspaceId) {
      query = query.eq('workspace_id', requestedWorkspaceId)
    }

    const { data: member, error: memberError } = await query.maybeSingle()

    const userAppMeta = (authData.user.app_metadata || {}) as Record<string, unknown>
    const userMeta = (authData.user.user_metadata || {}) as Record<string, unknown>
    const isGlobalAdmin = userAppMeta.role === 'ADMIN' || userMeta.role === 'ADMIN'
    const isOwner = member?.role === 'OWNER'
    const isAdmin = isGlobalAdmin || isOwner

    if (!member && !isGlobalAdmin) return null

    // Authenticated users in workspace have full sales permissions
    const capabilities = new Set<string>([
      'SALES_READ',
      'SALES_WRITE',
      'PRODUCT_WRITE',
      'COMMENT_INGEST',
      'PRINT',
      'SMS',
    ])

    if (isAdmin) {
      capabilities.add('ADMIN')
    }

    return {
      workspaceId: member?.workspace_id || requestedWorkspaceId || '',
      actorId: userId,
      actorType: 'USER',
      role: isGlobalAdmin ? 'ADMIN' : (member?.role || 'STAFF'),
      capabilities,
    }
  }

  return null
}
