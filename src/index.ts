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
