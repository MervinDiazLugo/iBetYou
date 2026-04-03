import Link from "next/link"

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold mb-2">API Docs</h1>
        <p className="text-muted-foreground mb-6">
          Interactive Swagger UI and OpenAPI JSON for iBetYou.
        </p>

        <div className="flex gap-4 mb-4">
          <Link href="/api-docs/swagger" className="underline">
            Open Swagger UI
          </Link>
          <Link href="/api/openapi" className="underline">
            Open OpenAPI JSON
          </Link>
        </div>

        <iframe
          src="/api-docs/swagger"
          title="Swagger UI"
          className="w-full h-[80vh] rounded border"
        />
      </div>
    </main>
  )
}
