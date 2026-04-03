// API Key validation utility
const API_KEY = process.env.NEXT_PUBLIC_APP_API_KEY

export function validateApiKey(request: Request): boolean {
  const apiKey = request.headers.get('x-api-key')
  return apiKey === API_KEY
}

export function withApiKey(handler: (request: Request) => Promise<Response>) {
  return async function(request: Request) {
    if (!validateApiKey(request)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
    return handler(request)
  }
}
