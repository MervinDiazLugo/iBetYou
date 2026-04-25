import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.RESEND_FROM || "onboarding@resend.dev"

export async function sendDepositApprovedEmail(params: {
  to: string
  nickname: string
  ibyCoins: number
  amount: number
}) {
  const { to, nickname, ibyCoins, amount } = params
  await resend.emails.send({
    from: FROM,
    to,
    subject: "✅ Recarga aprobada — iBetYou",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>¡Tu recarga fue aprobada!</h2>
        <p>Hola <strong>${nickname}</strong>,</p>
        <p>Tu solicitud de recarga fue procesada correctamente.</p>
        <table style="border-collapse:collapse;width:100%">
          <tr>
            <td style="padding:8px 0;color:#888">Monto reportado</td>
            <td style="padding:8px 0;font-weight:bold">$${amount.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#888">iBY Coins acreditados</td>
            <td style="padding:8px 0;font-weight:bold;color:#7c3aed">${ibyCoins.toFixed(2)} IBC</td>
          </tr>
        </table>
        <p style="margin-top:24px">Ya podés ver tu saldo actualizado en <a href="https://i-bet-you.vercel.app/top-up">iBetYou</a>.</p>
      </div>
    `,
  })
}

export async function sendDepositRejectedEmail(params: {
  to: string
  nickname: string
  amount: number
  reason: string
}) {
  const { to, nickname, amount, reason } = params
  await resend.emails.send({
    from: FROM,
    to,
    subject: "❌ Recarga rechazada — iBetYou",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Tu solicitud de recarga fue rechazada</h2>
        <p>Hola <strong>${nickname}</strong>,</p>
        <p>Revisamos tu solicitud de recarga por <strong>$${amount.toFixed(2)}</strong> y no pudimos aprobarla.</p>
        <p><strong>Motivo:</strong> ${reason}</p>
        <p>Si creés que es un error, contactá al soporte desde <a href="https://i-bet-you.vercel.app/top-up">tu historial de recargas</a>.</p>
      </div>
    `,
  })
}
