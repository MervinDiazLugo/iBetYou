import { MetadataRoute } from "next"

const BASE_URL = "https://i-bet-you.vercel.app"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/leaderboard", "/login", "/register", "/bet/"],
        disallow: [
          "/backoffice/",
          "/my-bets",
          "/balance",
          "/top-up",
          "/withdrawals",
          "/groups/",
          "/api/",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
