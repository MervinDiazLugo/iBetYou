"use client"

import Link from "next/link"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Trophy,
  ArrowRight,
  Users,
  DollarSign,
  Target,
  Clock,
  Star,
  ChevronRight,
  Percent,
} from "lucide-react"

function ExampleRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: "green" | "red" | "muted"
}) {
  const valueClass =
    highlight === "green"
      ? "text-green-500 font-bold"
      : highlight === "red"
      ? "text-red-400 font-bold"
      : "text-foreground font-medium"
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm ${valueClass}`}>{value}</span>
    </div>
  )
}

function BetTypeCard({
  icon,
  title,
  tag,
  tagColor,
  description,
  example,
  rows,
}: {
  icon: React.ReactNode
  title: string
  tag: string
  tagColor: string
  description: string
  example: string
  rows: { label: string; value: string; highlight?: "green" | "red" | "muted" }[]
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{icon}</div>
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tagColor}`}>
              {tag}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground pt-1">{description}</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div className="bg-secondary rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
            Ejemplo
          </p>
          <p className="text-sm text-foreground mb-3">{example}</p>
          <div className="space-y-0">
            {rows.map((r, i) => (
              <ExampleRow key={i} label={r.label} value={r.value} highlight={r.highlight} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function ComoJugarPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 py-10 max-w-4xl">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Trophy className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">Cómo Jugar</h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            iBetYou es una plataforma de apuestas deportivas{" "}
            <strong>entre usuarios reales</strong>. No apostás contra la casa, sino contra otra
            persona.
          </p>
        </div>

        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Creador vs. Aceptante
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Card className="border-primary/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-4 w-4 text-primary" />
                  Creador
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p>• Propone la apuesta eligiendo deporte, partido, tipo de apuesta y monto.</p>
                <p>• Define cuál resultado apuesta (ej. "Gana River").</p>
                <p>• Paga el monto + 3% de fee al publicar.</p>
                <p>• Espera a que alguien la acepte.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  Aceptante
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p>• Ve la apuesta en el Marketplace y decide tomarla.</p>
                <p>• Apuesta automáticamente por el resultado contrario.</p>
                <p>• En simétricas paga el mismo monto; en resultado exacto cubre monto × multiplicador.</p>
                <p>• El ganador recibe el pozo completo.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mb-12">
          <Card className="bg-secondary/50 border-border">
            <CardContent className="pt-5 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 shrink-0">
                  <Percent className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold mb-1">Fee de plataforma: 3%</p>
                  <p className="text-sm text-muted-foreground">
                    Tanto el <strong>creador</strong> como el <strong>aceptante</strong> pagan un
                    fee del 3% sobre el monto que reservan. El fee se descuenta al publicar o al
                    aceptar la apuesta.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ejemplo: apostás $20 → fee = $0.60 → se descontan $20.60 de tu balance.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Tipos de apuesta
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            Hay dos categorías: <strong>Simétricas</strong> (ambos arriesgan igual) y{" "}
            <strong>Asimétricas</strong> (solo para resultado exacto, donde el creador apuesta a un resultado difícil con mejor
            pago potencial).
          </p>

          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <BetTypeCard
              icon="⚔️"
              title="Directa"
              tag="Simétrica"
              tagColor="bg-blue-500/10 text-blue-400"
              description="Apostás al ganador del partido (o empate si aplica). El aceptante apuesta por el resultado contrario. Ambos ponen la misma cantidad en juego."
              example="Partido: River vs. Boca. Monto: $20 cada uno."
              rows={[
                { label: "Creador apuesta:", value: "Gana River" },
                { label: "Aceptante apuesta:", value: "No gana River (Boca o empate)" },
                { label: "Pozo total:", value: "$40" },
                { label: "Si gana River → recibe el creador:", value: "+$20 neto · $40 total", highlight: "green" },
                { label: "Si no gana River → recibe el aceptante:", value: "+$20 neto · $40 total", highlight: "green" },
                { label: "Fee creador (3%):", value: "-$0.60", highlight: "red" },
                { label: "Fee aceptante (3%):", value: "-$0.60", highlight: "red" },
              ]}
            />

            <BetTypeCard
              icon="⏱️"
              title="Medio Tiempo"
              tag="Simétrica"
              tagColor="bg-blue-500/10 text-blue-400"
              description="Igual que Directa pero el resultado que importa es el del primer tiempo, no el partido completo. El partido puede terminar distinto."
              example="Partido: Real Madrid vs. Barça. Monto: $15 cada uno."
              rows={[
                { label: "Creador apuesta:", value: "Gana Madrid al descanso" },
                { label: "Aceptante apuesta:", value: "No gana Madrid al descanso" },
                { label: "Pozo total:", value: "$30" },
                { label: "Si Madrid va ganando al 45':", value: "+$15 neto · $30 total", highlight: "green" },
                { label: "Si empata o gana Barça al 45':", value: "+$15 neto · $30 total", highlight: "green" },
                { label: "Fee creador (3%):", value: "-$0.45", highlight: "red" },
                { label: "Fee aceptante (3%):", value: "-$0.45", highlight: "red" },
              ]}
            />

            <BetTypeCard
              icon="🥅"
              title="Primer Anotador"
              tag="Simétrica"
              tagColor="bg-blue-500/10 text-blue-400"
              description="El creador elige quién anotará primero. El aceptante apuesta a que no será ese jugador o equipo. Ambos arriesgan el mismo monto base."
              example="Creador apuesta $10 a que Boca anota primero."
              rows={[
                { label: "Creador apuesta:", value: "$10 (Boca anota primero)" },
                { label: "Aceptante cubre:", value: "$10" },
                { label: "Pozo total:", value: "$20" },
                { label: "Si Boca anota primero → creador gana:", value: "+$10 neto · $20 total", highlight: "green" },
                { label: "Si anota otro → aceptante gana:", value: "+$10 neto · $20 total", highlight: "green" },
                { label: "Fee creador (3%):", value: "-$0.30", highlight: "red" },
                { label: "Fee aceptante (3%):", value: "-$0.30", highlight: "red" },
              ]}
            />
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-border" />
            <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
              Asimétricas — mayor riesgo, mayor premio
            </Badge>
            <div className="flex-1 h-px bg-border" />
          </div>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-xl mx-auto">
            En las apuestas asimétricas el creador apuesta a un resultado de baja probabilidad (un
            marcador exacto) y, para compensar el riesgo, define un{" "}
            <strong>multiplicador</strong> entre ×1 y ×5. A mayor multiplicador,{" "}
            <strong>el aceptante pone más tokens en juego</strong> mientras el creador pone menos.
          </p>

          <div className="grid sm:grid-cols-1 gap-4">
            <BetTypeCard
              icon="🎯"
              title="Resultado Exacto"
              tag="Asimétrica"
              tagColor="bg-yellow-500/10 text-yellow-400"
              description="El creador pronostica el marcador exacto del partido (ej. 2-1). Si atina, gana un premio multiplicado. El aceptante apuesta a que ese resultado no sucede."
              example="Creador apuesta $10 a que sale 2-1. Multiplicador ×3."
              rows={[
                { label: "Creador apuesta:", value: "$10 (marcador exacto 2-1)" },
                { label: "Aceptante cubre:", value: "$30 (×3 del monto)" },
                { label: "Pozo total:", value: "$40" },
                { label: "Si sale 2-1 → creador gana:", value: "+$30 neto · $40 total", highlight: "green" },
                { label: "Si NO sale 2-1 → aceptante gana:", value: "+$10 neto · $40 total", highlight: "green" },
                { label: "Fee creador (3%):", value: "-$0.30", highlight: "red" },
                { label: "Fee aceptante (3% sobre $30):", value: "-$0.90", highlight: "red" },
              ]}
            />
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            ¿Cómo funciona el multiplicador?
          </h2>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground mb-4">
                En las apuestas asimétricas (solo Resultado Exacto), el creador define
                un multiplicador al publicar la apuesta. Este número indica cuántas veces el monto
                base debe cubrir el aceptante.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Multiplicador</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Creador pone</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Aceptante pone</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Pozo total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { mult: "×1", creator: "$10", acceptor: "$10", pot: "$20" },
                      { mult: "×2", creator: "$10", acceptor: "$20", pot: "$30" },
                      { mult: "×3", creator: "$10", acceptor: "$30", pot: "$40" },
                      { mult: "×4", creator: "$10", acceptor: "$40", pot: "$50" },
                      { mult: "×5", creator: "$10", acceptor: "$50", pot: "$60" },
                    ].map((row, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4 font-semibold">{row.mult}</td>
                        <td className="text-right py-2 pr-4 text-blue-400">{row.creator}</td>
                        <td className="text-right py-2 pr-4 text-orange-400">{row.acceptor}</td>
                        <td className="text-right py-2 text-green-400 font-bold">{row.pot}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                * Ejemplo con monto base = $10. El <span className="text-blue-400">creador</span> siempre pone el monto base.
                El <span className="text-orange-400">aceptante</span> pone monto × multiplicador. El ganador recibe el <span className="text-green-400">pozo total</span>.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Ciclo de vida de una apuesta
          </h2>
          <div className="space-y-2">
            {[
              {
                step: "1",
                label: "Abierta",
                color: "bg-green-500",
                desc: 'El creador publicó la apuesta. Está esperando un aceptante en el Marketplace. El monto del creador queda reservado.',
              },
              {
                step: "2",
                label: "Tomada",
                color: "bg-blue-500",
                desc: 'Un aceptante la tomó. Ambos montos están reservados. La apuesta queda en curso hasta que finalice el evento.',
              },
              {
                step: "3",
                label: "Pendiente de aprobación",
                color: "bg-orange-500",
                desc: 'El sistema detectó un resultado. Un admin verifica y aprueba la resolución.',
              },
              {
                step: "4a",
                label: "Resuelta",
                color: "bg-purple-500",
                desc: 'El ganador recibe el pozo completo en su balance de Fantasy Tokens.',
              },
              {
                step: "4b",
                label: "Cancelada",
                color: "bg-red-500",
                desc: 'Si el admin cancela la apuesta, ambos jugadores reciben de vuelta sus tokens automáticamente.',
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-3 items-start">
                <div
                  className={`w-7 h-7 rounded-full ${item.color} text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5`}
                >
                  {item.step}
                </div>
                <div>
                  <span className="font-semibold text-sm">{item.label}: </span>
                  <span className="text-sm text-muted-foreground">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="text-center">
          <Button asChild size="lg">
            <Link href="/">
              Ir al Marketplace
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground mt-3">
            ¿Querés crear tu propia apuesta?{" "}
            <Link href="/?create=true" className="underline hover:text-foreground">
              Publicá una aquí
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
