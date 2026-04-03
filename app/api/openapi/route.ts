import { NextRequest, NextResponse } from "next/server"

function buildSpec(origin: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "iBetYou API",
      version: "1.0.0",
      description: "OpenAPI specification for iBetYou backend routes.",
    },
    servers: [{ url: origin }],
    tags: [
      { name: "Auth" },
      { name: "Bets" },
      { name: "Events" },
      { name: "Wallet" },
      { name: "User" },
      { name: "Admin" },
      { name: "Maintenance" },
      { name: "Docs" },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/api/openapi": {
        get: {
          tags: ["Docs"],
          summary: "Get OpenAPI document",
          responses: {
            "200": { description: "OpenAPI spec" },
          },
        },
      },
      "/api/auth/callback": {
        get: {
          tags: ["Auth"],
          summary: "Auth callback",
          parameters: [
            {
              name: "code",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            "302": { description: "Redirect" },
          },
        },
      },
      "/api/auth/login-bonus": {
        post: {
          tags: ["Auth"],
          summary: "Apply login bonus",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["userId"],
                  properties: { userId: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Processed" },
            "400": { description: "Invalid request" },
          },
        },
      },
      "/api/auth/register/nickname": {
        post: {
          tags: ["Auth"],
          summary: "Set nickname for user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["userId", "nickname"],
                  properties: {
                    userId: { type: "string" },
                    nickname: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Nickname assigned" },
            "400": { description: "Invalid request" },
          },
        },
      },
      "/api/bets": {
        get: {
          tags: ["Bets"],
          summary: "List bets",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": { description: "Bets list" },
            "401": { description: "Unauthorized" },
          },
        },
        post: {
          tags: ["Bets"],
          summary: "Create bet (legacy endpoint)",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user_id: { type: "string" },
                    event_id: { type: "number" },
                    bet_type: { type: "string" },
                    creator_selection: { type: "string" },
                    amount: { type: "number" },
                    multiplier: { type: "number" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Bet created" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/bets/create": {
        post: {
          tags: ["Bets"],
          summary: "Create bet",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["userId", "eventId", "betType", "selection", "amount"],
                  properties: {
                    userId: { type: "string" },
                    eventId: { type: "number" },
                    betType: { type: "string" },
                    selection: { type: "object" },
                    amount: { type: "number" },
                    multiplier: { type: "number" },
                    fee: { type: "number" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Bet created" },
            "400": { description: "Validation error" },
          },
        },
      },
      "/api/bets/{id}": {
        get: {
          tags: ["Bets"],
          summary: "Get bet detail",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "user_id",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Bet detail" },
            "404": { description: "Not found" },
          },
        },
        patch: {
          tags: ["Bets"],
          summary: "Take bet",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user_id"],
                  properties: {
                    user_id: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Bet taken" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/bets/{id}/clone": {
        get: {
          tags: ["Bets"],
          summary: "Get clone payload for bet",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Clone payload" },
            "404": { description: "Not found" },
          },
        },
      },
      "/api/events": {
        get: {
          tags: ["Events"],
          summary: "List events",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": { description: "Events list" },
          },
        },
      },
      "/api/events/list": {
        get: {
          tags: ["Events"],
          summary: "List filtered events",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "sport", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Filtered events" },
          },
        },
      },
      "/api/events/seed": {
        post: {
          tags: ["Events"],
          summary: "Seed events",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": { description: "Seed complete" },
          },
        },
      },
      "/api/events/sync": {
        post: {
          tags: ["Events"],
          summary: "Sync events",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": { description: "Sync complete" },
          },
        },
      },
      "/api/my-bets": {
        get: {
          tags: ["Bets"],
          summary: "Get user bets",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "user_id",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "User bets" },
            "400": { description: "Missing user_id" },
          },
        },
      },
      "/api/wallet": {
        get: {
          tags: ["Wallet"],
          summary: "Get wallet and user profile",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "user_id",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Wallet data" },
            "400": { description: "Missing user_id" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/user": {
        post: {
          tags: ["User"],
          summary: "Get user aggregate data",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user_id"],
                  properties: {
                    user_id: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "User aggregate" },
          },
        },
      },
      "/api/user/info": {
        get: {
          tags: ["User"],
          summary: "Get current user info",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": { description: "User info" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/user/profile": {
        get: {
          tags: ["User"],
          summary: "Get user profile + stats",
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: "x-user-id",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Profile payload" },
            "400": { description: "Missing x-user-id" },
          },
        },
      },
      "/api/admin/bets": {
        get: {
          tags: ["Admin"],
          summary: "Admin list bets",
          security: [{ BearerAuth: [] }],
          responses: { "200": { description: "Bets list" } },
        },
        patch: {
          tags: ["Admin"],
          summary: "Admin update/resolve/cancel bet",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: { "200": { description: "Updated" } },
        },
        post: {
          tags: ["Admin"],
          summary: "Admin auto-resolve bet",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: { "200": { description: "Resolved" } },
        },
      },
      "/api/admin/events": {
        get: {
          tags: ["Admin"],
          summary: "Admin list events",
          security: [{ BearerAuth: [] }],
          responses: { "200": { description: "Events list" } },
        },
        post: {
          tags: ["Admin"],
          summary: "Admin create/update event",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: { "200": { description: "Upserted" } },
        },
        delete: {
          tags: ["Admin"],
          summary: "Admin delete event",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Deleted" } },
        },
      },
      "/api/admin/wallets": {
        get: {
          tags: ["Admin"],
          summary: "Admin list wallets",
          security: [{ BearerAuth: [] }],
          responses: { "200": { description: "Wallets list" } },
        },
        post: {
          tags: ["Admin"],
          summary: "Admin wallet transaction",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: { "200": { description: "Transaction applied" } },
        },
      },
      "/api/cleanup": {
        post: {
          tags: ["Maintenance"],
          summary: "Cleanup stale data",
          security: [{ BearerAuth: [] }],
          responses: { "200": { description: "Cleanup done" } },
        },
      },
    },
  }
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  return NextResponse.json(buildSpec(origin), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  })
}

