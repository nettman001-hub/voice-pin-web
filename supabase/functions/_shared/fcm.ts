// Firebase Cloud Messaging(HTTP v1) 발송. 웹이 문자를 대기열에 넣으면 휴대폰을 깨우는 데 쓴다.
// 서비스 계정 키(JSON)는 Supabase 비밀값 FCM_SERVICE_ACCOUNT_JSON에 둔다. 없으면 알림 없이 기존 주기 확인만 한다.
// Deno와 Node(테스트) 양쪽에서 돌도록 전역 crypto.subtle과 주입 가능한 fetch만 쓴다.

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

export interface ServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
  tokenUri: string
}

export type PushResult = 'SENT' | 'STALE_TOKEN' | 'FAILED'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function parseServiceAccount(raw: string | null | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null
  try {
    const value = JSON.parse(raw)
    const projectId = String(value.project_id ?? '').trim()
    const clientEmail = String(value.client_email ?? '').trim()
    const privateKey = String(value.private_key ?? '')
    if (!projectId || !clientEmail || !privateKey.includes('PRIVATE KEY')) return null
    return {
      projectId,
      clientEmail,
      privateKey,
      tokenUri: String(value.token_uri || 'https://oauth2.googleapis.com/token'),
    }
  } catch {
    return null
  }
}

const base64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const pemToDer = (pem: string) => {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s/g, '')
  const raw = atob(body)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

/** Google OAuth용 서비스 계정 JWT(RS256) */
export async function signServiceJwt(account: ServiceAccount, nowSeconds: number) {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(JSON.stringify({
    iss: account.clientEmail,
    scope: FCM_SCOPE,
    aud: account.tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`))
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`
}

/**
 * 토큰이 더는 쓸 수 없는지 판단한다. 우리 메시지 형식은 고정이라 INVALID_ARGUMENT도 토큰 문제로 본다.
 * https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
 */
export function classifyFcmError(status: number, body: unknown): PushResult {
  const error = (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } })?.error
  const errorCode = error?.details?.find((detail) => detail?.errorCode)?.errorCode
  if (errorCode === 'UNREGISTERED' || errorCode === 'SENDER_ID_MISMATCH' || errorCode === 'INVALID_ARGUMENT') return 'STALE_TOKEN'
  if (status === 404 || (status === 400 && error?.status === 'INVALID_ARGUMENT')) return 'STALE_TOKEN'
  return 'FAILED'
}

/** 내용 없는 고우선순위 데이터 메시지. 휴대폰은 받으면 바로 outbox-claim을 부른다. */
export const outboxPushMessage = (token: string) => ({
  message: {
    token,
    data: { type: 'OUTBOX' },
    android: { priority: 'HIGH', ttl: '900s', collapse_key: 'outbox' },
  },
})

export function createFcmSender(account: ServiceAccount, fetchImpl: FetchLike = fetch, now: () => number = Date.now) {
  let cached: { token: string; expiresAt: number } | null = null

  const accessToken = async () => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token
    const assertion = await signServiceJwt(account, Math.floor(now() / 1000))
    const response = await fetchImpl(account.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body?.access_token) throw new Error(`FCM 인증 실패 (${response.status})`)
    cached = { token: String(body.access_token), expiresAt: now() + Number(body.expires_in || 3600) * 1000 }
    return cached.token
  }

  return async function sendOutboxPush(token: string): Promise<PushResult> {
    const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(outboxPushMessage(token)),
    })
    if (response.ok) return 'SENT'
    if (response.status === 401) cached = null
    return classifyFcmError(response.status, await response.json().catch(() => ({})))
  }
}
