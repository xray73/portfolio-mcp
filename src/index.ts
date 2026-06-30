import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  DB: D1Database;
}

export class PortfolioMCP extends McpAgent {
  server = new McpServer({
    name: "portfolio-command-center",
    version: "1.0.0",
  });

  async init() {
    // Primo tool di prova: get_macro
    this.server.tool(
      "get_macro",
      "Restituisce tutti i parametri macro correnti (CPI, tassi, crescita, mercati) con stato semaforo e conteggio alert/sorveglianza/ok.",
      {},
      async () => {
        const env = this.env as Env;

        const { results } = await env.DB.prepare(
          `SELECT nome, valore, stato, data_riferimento, note
           FROM t_macro_params
           ORDER BY nome`
        ).all();

        const alertCount = {
          alert: results.filter((r: any) =>
            String(r.stato).toUpperCase().includes("ALERT")
          ).length,
          vicino: results.filter((r: any) =>
            String(r.stato).toUpperCase().includes("VICINO")
          ).length,
          ok: results.filter((r: any) =>
            String(r.stato).toUpperCase().includes("OK")
          ).length,
        };

        const payload = {
          generated_at: new Date().toISOString(),
          parametri: results,
          alert_count: alertCount,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      }
    );

    // ── get_alert ──────────────────────────────────────────────
    this.server.tool(
      "get_alert",
      "Restituisce le soglie operative attive e il conteggio alert/vicino/ok, dalla view v_alert_attivi.",
      {},
      async () => {
        const env = this.env as Env;
        const { results } = await env.DB.prepare(
          `SELECT * FROM v_alert_attivi ORDER BY nome`
        ).all();

        const macro = await env.DB.prepare(
          `SELECT stato FROM t_macro_params`
        ).all();
        const alertCount = {
          alert: macro.results.filter((r: any) =>
            String(r.stato).toUpperCase().includes("ALERT")
          ).length,
          vicino: macro.results.filter((r: any) =>
            String(r.stato).toUpperCase().includes("VICINO")
          ).length,
          ok: macro.results.filter((r: any) =>
            String(r.stato).toUpperCase().includes("OK")
          ).length,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ attivi: results, alert_count: alertCount }, null, 2),
            },
          ],
        };
      }
    );

    // ── get_ytd ────────────────────────────────────────────────
    this.server.tool(
      "get_ytd",
      "Restituisce performance YTD per ETF: ticker, nome, peso, prezzo attuale, YTD%, contributo ponderato.",
      {},
      async () => {
        const env = this.env as Env;
        const { results } = await env.DB.prepare(
          'SELECT ticker, nome, peso_target AS peso, prezzo_attuale, ytd_pct, ROUND(ytd_pct * peso_target / 100, 4) AS contributo_ponderato FROM t_etf_riepilogo ORDER BY ticker'
        ).all();

        return {
          content: [{ type: "text", text: JSON.stringify({ etf: results }, null, 2) }],
        };
      }
    );

    // ── get_capitale ───────────────────────────────────────────
    this.server.tool(
      "get_capitale",
      "Restituisce stato capitale: ETF riepilogo e YTD ponderato del portafoglio.",
      {},
      async () => {
        const env = this.env as Env;
        const { results } = await env.DB.prepare(
          `SELECT ticker, peso_target AS peso, prezzo_attuale, ytd_pct, ROUND(ytd_pct * peso_target / 100, 4) AS contributo_ponderato FROM t_etf_riepilogo`
        ).all();

        const ytdPonderato = results.reduce(
          (sum: number, r: any) => sum + (Number(r.contributo_ponderato) || 0),
          0
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ etf: results, ytd_ponderato: ytdPonderato }, null, 2),
            },
          ],
        };
      }
    );

    // ── get_portfolio ──────────────────────────────────────────
    this.server.tool(
      "get_portfolio",
      "Restituisce registro ETF e allocazione corrente dalla view v_portafoglio_corrente.",
      {},
      async () => {
        const env = this.env as Env;
        const { results } = await env.DB.prepare(
          `SELECT * FROM v_portafoglio_corrente ORDER BY ticker`
        ).all();

        return {
          content: [{ type: "text", text: JSON.stringify({ portafoglio: results }, null, 2) }],
        };
      }
    );

    // ── get_scenario ───────────────────────────────────────────
    this.server.tool(
      "get_scenario",
      "Restituisce gli scenari macro Bayesiani con probabilità e lo scenario prevalente.",
      {},
      async () => {
        const env = this.env as Env;
        const scenari = await env.DB.prepare(
          `SELECT * FROM t_scenario_scores ORDER BY scenario`
        ).all();
        const prevalente = await env.DB.prepare(
          `SELECT * FROM v_scenario_prevalente LIMIT 1`
        ).all();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { scenari: scenari.results, prevalente: prevalente.results[0] ?? null },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // ── get_log ────────────────────────────────────────────────
    this.server.tool(
      "get_log",
      "Restituisce le ultime 10 azioni operative registrate.",
      {},
      async () => {
        const env = this.env as Env;
        const { results } = await env.DB.prepare(
          `SELECT * FROM t_log_azioni ORDER BY data DESC LIMIT 10`
        ).all();

        return {
          content: [{ type: "text", text: JSON.stringify({ log_azioni: results }, null, 2) }],
        };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      // @ts-ignore - mount fornito da McpAgent
      return PortfolioMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      // @ts-ignore
      return PortfolioMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Portfolio MCP server — endpoint: /sse o /mcp", {
      status: 200,
    });
  },
};
